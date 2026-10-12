import "server-only";

import { and, count, eq, gt } from "drizzle-orm";

import { db, schema } from "./db";
import type { NetworkKey } from "./networks";

/** Daily ceilings on gas the relayer will pay. Mainnet MON is real money, so its limits are tight. */
const LIMITS: Record<NetworkKey, { perAddress: number; total: number }> = {
  mainnet: { perAddress: 25, total: 300 },
  testnet: { perAddress: 60, total: 2000 },
  local: { perAddress: 10_000, total: 100_000 },
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Returns an error message if this address (or the whole network) has used up today's budget. */
export async function checkBudget(network: NetworkKey, address: string): Promise<string | null> {
  try {
    const d = await db();
    const since = new Date(Date.now() - DAY_MS);
    const [total] = await d
      .select({ n: count() })
      .from(schema.relayJobs)
      .where(and(eq(schema.relayJobs.network, network), gt(schema.relayJobs.createdAt, since)));
    if (total.n >= LIMITS[network].total) return "Kinpot has reached its free transaction limit for today. Try again tomorrow.";
    const [mine] = await d
      .select({ n: count() })
      .from(schema.relayJobs)
      .where(and(eq(schema.relayJobs.network, network), eq(schema.relayJobs.address, address.toLowerCase()), gt(schema.relayJobs.createdAt, since)));
    if (mine.n >= LIMITS[network].perAddress) return "You've reached today's limit of free transactions. Try again tomorrow.";
    return null;
  } catch {
    return null; // never block the product because the budget table is unreachable
  }
}

export async function recordRelay(network: NetworkKey, address: string, kind: string, txHash: string) {
  try {
    const d = await db();
    await d.insert(schema.relayJobs).values({ network, address: address.toLowerCase(), kind, txHash });
  } catch {
    // best effort
  }
}
