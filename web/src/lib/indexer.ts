import type { Address } from "viem";

import { networks, type NetworkKey } from "./networks";

/** Envio GraphQL endpoint per network. Without one, the app reads the chain directly and skips the feed. */
const ENDPOINTS: Partial<Record<NetworkKey, string | undefined>> = {
  testnet: process.env.NEXT_PUBLIC_ENVIO_TESTNET,
  mainnet: process.env.NEXT_PUBLIC_ENVIO_MAINNET,
};

export function hasIndexer(network: NetworkKey): boolean {
  return Boolean(ENDPOINTS[network]);
}

async function gql<T>(network: NetworkKey, query: string, variables: Record<string, unknown>): Promise<T> {
  const url = ENDPOINTS[network];
  if (!url) throw new Error("No indexer for this network.");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data as T;
}

export type ActivityKind =
  | "created"
  | "contributed"
  | "confirmed"
  | "declined"
  | "cancelled"
  | "paid"
  | "closed"
  | "refunded"
  | "refund_failed";

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  actor: Address | null;
  amount: string | null;
  timestamp: string;
  txHash: string;
};

const potKey = (network: NetworkKey, potId: bigint) => `${networks[network].chain.id}-${potId}`;

export async function fetchActivity(network: NetworkKey, potId: bigint): Promise<ActivityItem[]> {
  const data = await gql<{ Activity: ActivityItem[] }>(
    network,
    `query ($pot: String!) {
      Activity(where: { pot_id: { _eq: $pot } }, order_by: { timestamp: desc }, limit: 50) {
        id kind actor amount timestamp txHash
      }
    }`,
    { pot: potKey(network, potId) },
  );
  return data.Activity;
}

/** Pot IDs this address has paid into. Lowercase match: addresses are stored as emitted. */
export async function fetchContributedPotIds(network: NetworkKey, address: Address): Promise<string[]> {
  const data = await gql<{ Participant: { pot_id: string }[] }>(
    network,
    `query ($a: String!) {
      Participant(where: { address: { _ilike: $a } }, limit: 100) { pot_id }
    }`,
    { a: address },
  );
  return data.Participant.map((p) => p.pot_id.split("-")[1]);
}
