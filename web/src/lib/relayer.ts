import "server-only";

import { createWalletClient, fallback, http, parseEventLogs, type Address, type Hex } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";

import { kinpotAbi } from "./abi";
import { networks, publicClient, type NetworkKey } from "./networks";

const accounts = new Map<string, ReturnType<typeof privateKeyToAccount>>();
function relayer() {
  const key = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("RELAYER_PRIVATE_KEY is not set.");
  let account = accounts.get(key);
  if (!account) {
    account = privateKeyToAccount(key, { nonceManager });
    accounts.set(key, account);
  }
  return account;
}

function walletClient(network: NetworkKey) {
  const net = networks[network];
  return createWalletClient({
    account: relayer(),
    chain: net.chain,
    transport: fallback(net.rpc.map((url) => http(url))),
  });
}

export type Call = { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] };

/** Simulate, size the gas limit tightly (Monad charges the declared limit), send, wait. */
export async function submit(network: NetworkKey, call: Call) {
  const client = publicClient(network);
  const account = relayer();
  await client.simulateContract({ ...call, account } as never);
  const estimate = await client.estimateContractGas({ ...call, account } as never);
  const hash = await walletClient(network).writeContract({ ...call, gas: (estimate * 115n) / 100n } as never);
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 30_000 });
  if (receipt.status !== "success") throw new Error("The transaction reverted.");
  const created = parseEventLogs({ abi: kinpotAbi, logs: receipt.logs, eventName: "PotCreated" })[0];
  return { hash, potId: created ? created.args.potId.toString() : undefined };
}

