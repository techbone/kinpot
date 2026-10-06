import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

import { kinpotAbi } from "./abi";
import { publicClient, type NetworkKey } from "./networks";
import { networks } from "./networks";

export const AUSD_DECIMALS = 6;

export const STATUS = ["None", "Open", "Paid", "Closed"] as const;
export type PotStatus = (typeof STATUS)[number];

export type Pot = {
  id: bigint;
  organizer: Address;
  payee: Address;
  dueAt: number;
  expiresAt: number;
  status: PotStatus;
  payeeConfirmed: boolean;
  target: bigint;
  raised: bigint;
  refunded: boolean;
  billHash: Hex;
};

export type Contribution = { contributor: Address; amount: bigint; refundOwed: bigint };

/** Where a pot is in its life, from the family's point of view. */
export type Phase =
  | "collecting" // not fully funded yet
  | "awaiting-payee" // funded, payee hasn't confirmed
  | "scheduled" // funded and confirmed, waiting for the due date
  | "ready" // can be paid right now
  | "paid"
  | "refunding" // closed or expired, refunds not sent yet
  | "refunded";

export function phaseOf(pot: Pot, now: number): Phase {
  if (pot.status === "Paid") return "paid";
  if (pot.refunded) return "refunded";
  if (pot.status === "Closed" || now > pot.expiresAt) return "refunding";
  if (pot.raised < pot.target) return "collecting";
  if (!pot.payeeConfirmed) return "awaiting-payee";
  return now >= pot.dueAt ? "ready" : "scheduled";
}

function kinpotAddress(network: NetworkKey): Address {
  const address = networks[network].deployment?.kinpot;
  if (!address) throw new Error(`Kinpot isn't deployed on ${networks[network].label} yet.`);
  return address;
}

export async function readPot(network: NetworkKey, id: bigint): Promise<Pot | null> {
  const raw = await publicClient(network).readContract({
    address: kinpotAddress(network),
    abi: kinpotAbi,
    functionName: "getPot",
    args: [id],
  });
  if (raw.status === 0) return null;
  return {
    id,
    organizer: raw.organizer,
    payee: raw.payee,
    dueAt: Number(raw.dueAt),
    expiresAt: Number(raw.expiresAt),
    status: STATUS[raw.status],
    payeeConfirmed: raw.payeeConfirmed,
    target: raw.target,
    raised: raw.raised,
    refunded: raw.refunded,
    billHash: raw.billHash,
  };
}

export async function readContributions(network: NetworkKey, id: bigint): Promise<Contribution[]> {
  const client = publicClient(network);
  const address = kinpotAddress(network);
  const contributors = await client.readContract({ address, abi: kinpotAbi, functionName: "contributorsOf", args: [id] });
  if (contributors.length === 0) return [];
  // Plain reads rather than multicall, so a local anvil chain (no Multicall3) works too.
  const read = (functionName: "contributed" | "refundOwed", c: Address) =>
    client.readContract({ address, abi: kinpotAbi, functionName, args: [id, c] });
  return Promise.all(
    contributors.map(async (contributor) => {
      const [amount, refundOwed] = await Promise.all([read("contributed", contributor), read("refundOwed", contributor)]);
      return { contributor, amount, refundOwed };
    }),
  );
}

/** The most recent pots, newest first. Envio replaces this in M4. */
export async function readRecentPots(network: NetworkKey, limit = 25): Promise<Pot[]> {
  const count = await publicClient(network).readContract({
    address: kinpotAddress(network),
    abi: kinpotAbi,
    functionName: "potCount",
  });
  const ids: bigint[] = [];
  for (let id = count; id > 0n && ids.length < limit; id--) ids.push(id);
  const pots = await Promise.all(ids.map((id) => readPot(network, id)));
  return pots.filter((p): p is Pot => p !== null);
}

/** Must match Kinpot.authorizationNonce: keccak256(abi.encode(potId, salt)). */
export function authorizationNonce(potId: bigint, salt: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [potId, salt]));
}
