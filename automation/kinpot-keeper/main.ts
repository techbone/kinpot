// Kinpot automation: a Chainlink CRE workflow that pays due pots and refunds expired ones.
//
// Every minute it reads KinpotAutomation.pending() (one call returns every pot that can be paid
// or refunded right now). If anything is waiting, it signs a report of those pot IDs and writes it
// to KinpotAutomation through the Chainlink forwarder, which calls Kinpot.release / Kinpot.refund.
import {
  bytesToHex,
  cre,
  encodeCallMsg,
  getNetwork,
  LATEST_BLOCK_NUMBER,
  prepareReportRequest,
  Runner,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, zeroAddress, type Address } from "viem";
import { z } from "zod";

const configSchema = z.object({
  schedule: z.string(),
  chainSelectorName: z.string(),
  isTestnet: z.boolean(),
  kinpot: z.string(),
  automation: z.string(),
  /** How many of the most recent pots to scan each run. */
  scan: z.number().int().positive().max(500),
  gasLimit: z.string(),
});
type Config = z.infer<typeof configSchema>;

const kinpotAbi = [
  { type: "function", name: "potCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const automationAbi = [
  {
    type: "function",
    name: "pending",
    stateMutability: "view",
    inputs: [
      { name: "fromId", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
    outputs: [
      { name: "releaseIds", type: "uint256[]" },
      { name: "refundIds", type: "uint256[]" },
    ],
  },
] as const;

function read<const abi extends typeof kinpotAbi | typeof automationAbi>(
  runtime: Runtime<Config>,
  evm: InstanceType<typeof cre.capabilities.EVMClient>,
  to: string,
  abi: abi,
  functionName: abi[number]["name"],
  args: readonly unknown[] = [],
) {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const reply = evm
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to: to as Address, data }),
      blockNumber: LATEST_BLOCK_NUMBER,
    })
    .result();
  return decodeFunctionResult({ abi, functionName, data: bytesToHex(reply.data) } as never);
}

const onTick = (runtime: Runtime<Config>): string => {
  const config = runtime.config;
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName, isTestnet: config.isTestnet });
  if (!network) throw new Error(`Unknown chain ${config.chainSelectorName}`);
  const evm = new cre.capabilities.EVMClient(network.chainSelector.selector);

  const count = read(runtime, evm, config.kinpot, kinpotAbi, "potCount") as bigint;
  if (count === 0n) return "no pots yet";
  const scan = BigInt(config.scan);
  const from = count > scan ? count - scan + 1n : 1n;
  const [releaseIds, refundIds] = read(runtime, evm, config.automation, automationAbi, "pending", [from, scan]) as [
    readonly bigint[],
    readonly bigint[],
  ];

  if (releaseIds.length === 0 && refundIds.length === 0) {
    runtime.log(`Scanned pots ${from}..${count}: nothing due.`);
    return "nothing due";
  }
  runtime.log(`Paying ${releaseIds.join(", ") || "none"}; refunding ${refundIds.join(", ") || "none"}.`);

  const payload = encodeAbiParameters([{ type: "uint256[]" }, { type: "uint256[]" }], [releaseIds, refundIds]);
  const report = runtime.report(prepareReportRequest(payload)).result();
  const reply = evm
    .writeReport(runtime, {
      receiver: config.automation,
      report,
      gasConfig: { gasLimit: config.gasLimit },
    })
    .result();

  const hash = reply.txHash ? bytesToHex(reply.txHash) : "unknown";
  runtime.log(`Report written in ${hash} (receiver status ${reply.receiverContractExecutionStatus ?? "n/a"}).`);
  return hash;
};

const initWorkflow = (config: Config) => {
  const cron = new cre.capabilities.CronCapability();
  return [cre.handler(cron.trigger({ schedule: config.schedule }), onTick)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
