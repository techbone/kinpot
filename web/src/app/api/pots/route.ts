import { and, eq, inArray, or } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { kinpotAbi } from "@/lib/abi";
import { billHash, isBill } from "@/lib/bill";
import { db, schema } from "@/lib/db";
import type { PotMeta } from "@/lib/messages";
import { isNetworkKey, networks, publicClient } from "@/lib/networks";

export const runtime = "nodejs";

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function slug() {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/**
 * GET ?slug=…                       → one pot's metadata, with network and potId
 * GET ?network=…&potId=…            → one pot's metadata
 * GET ?network=…&address=…          → pots this address started or is the payee of
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const d = await db();

  const bySlug = url.searchParams.get("slug");
  const network = url.searchParams.get("network");
  const potId = url.searchParams.get("potId");
  const address = url.searchParams.get("address");

  if (bySlug) {
    const [row] = await d.select().from(schema.pots).where(eq(schema.pots.slug, bySlug));
    if (!row) return fail("Pot not found.", 404);
    const key = Object.values(networks).find((n) => n.chain.id === row.chainId)?.key;
    return Response.json({ network: key, potId: row.potId, meta: await metaFor(row) });
  }

  if (!isNetworkKey(network)) return fail("Unknown network.");
  const chainId = networks[network].chain.id;

  if (potId) {
    const [row] = await d
      .select()
      .from(schema.pots)
      .where(and(eq(schema.pots.chainId, chainId), eq(schema.pots.potId, potId)));
    return Response.json({ meta: row ? await metaFor(row) : null });
  }

  if (address && isAddress(address)) {
    const a = getAddress(address);
    const rows = await d
      .select()
      .from(schema.pots)
      .where(and(eq(schema.pots.chainId, chainId), or(eq(schema.pots.organizer, a), eq(schema.pots.payee, a))));
    const claimed = await d
      .select()
      .from(schema.shareClaims)
      .where(and(eq(schema.shareClaims.chainId, chainId), eq(schema.shareClaims.address, a)));
    const extraIds = claimed.map((c) => c.potId).filter((id) => !rows.some((r) => r.potId === id));
    const extra = extraIds.length
      ? await d
          .select()
          .from(schema.pots)
          .where(and(eq(schema.pots.chainId, chainId), inArray(schema.pots.potId, extraIds)))
      : [];
    return Response.json({
      pots: [...rows, ...extra].map((r) => ({
        potId: r.potId,
        slug: r.slug,
        title: r.bill.title,
        category: r.bill.category,
        payeeName: r.bill.payeeName,
        organizer: r.organizer,
        payee: r.payee,
      })),
    });
  }

  return fail("Missing query.");
}

async function metaFor(row: typeof schema.pots.$inferSelect): Promise<PotMeta> {
  const d = await db();
  const claims = await d
    .select()
    .from(schema.shareClaims)
    .where(and(eq(schema.shareClaims.chainId, row.chainId), eq(schema.shareClaims.potId, row.potId)));
  const [payee] = await d.select().from(schema.payees).where(eq(schema.payees.address, row.payee));
  const addresses = [...new Set([row.organizer, row.payee, ...claims.map((c) => c.address)])];
  const profiles = await d.select().from(schema.profiles).where(inArray(schema.profiles.address, addresses));
  return {
    slug: row.slug,
    bill: row.bill,
    claims: claims.map((c) => ({ shareIndex: c.shareIndex, address: getAddress(c.address) })),
    names: Object.fromEntries(profiles.map((p) => [p.address, p.name])),
    payee: payee ? { name: payee.name, kind: payee.kind, city: payee.city, verified: payee.verified } : undefined,
  };
}

/** Stores a pot's bill details. Accepted only if they hash to the billHash stored onchain. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { network?: unknown; potId?: unknown; bill?: unknown } | null;
  if (!body || !isNetworkKey(body.network) || typeof body.potId !== "string" || !/^\d+$/.test(body.potId)) {
    return fail("Invalid request.");
  }
  if (!isBill(body.bill)) return fail("Invalid bill details.");
  const net = networks[body.network];
  if (!net.deployment) return fail("Not deployed on this network.");

  const pot = await publicClient(net.key).readContract({
    address: net.deployment.kinpot,
    abi: kinpotAbi,
    functionName: "getPot",
    args: [BigInt(body.potId)],
  });
  if (pot.status === 0) return fail("Pot not found onchain.", 404);
  if (pot.billHash !== billHash(body.bill)) return fail("These details don't match the pot's onchain bill hash.", 422);

  const d = await db();
  const [existing] = await d
    .select()
    .from(schema.pots)
    .where(and(eq(schema.pots.chainId, net.chain.id), eq(schema.pots.potId, body.potId)));
  if (existing) return Response.json({ slug: existing.slug });

  const row = {
    chainId: net.chain.id,
    potId: body.potId,
    slug: slug(),
    bill: body.bill,
    billHash: pot.billHash,
    organizer: getAddress(pot.organizer),
    payee: getAddress(pot.payee),
  };
  await d.insert(schema.pots).values(row).onConflictDoNothing();
  return Response.json({ slug: row.slug });
}
