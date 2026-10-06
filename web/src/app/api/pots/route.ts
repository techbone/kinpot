import { and, eq, inArray, or } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import { kinpotAbi } from "@/lib/abi";
import { billHash, isBill } from "@/lib/bill";
import { db, schema } from "@/lib/db";
import type { PotMeta } from "@/lib/messages";
import { isNetworkKey, networkForScope, networks, publicClient, scopeOf } from "@/lib/networks";

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
 * GET ?network=…&address=…          → pots this address started, is the payee of, or claimed a share in
 * GET ?network=…&ids=1,2,3           → summaries for these pots (e.g. ones the indexer says you paid into)
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
    const key = networkForScope(row.scope);
    return Response.json({ network: key, potId: row.potId, meta: await metaFor(row) });
  }

  if (!isNetworkKey(network)) return fail("Unknown network.");
  const scope = scopeOf(network);
  if (!scope) return fail("Not deployed on this network.");

  if (potId) {
    const [row] = await d
      .select()
      .from(schema.pots)
      .where(and(eq(schema.pots.scope, scope), eq(schema.pots.potId, potId)));
    return Response.json({ meta: row ? await metaFor(row) : null });
  }

  const ids = url.searchParams.get("ids");
  if (ids) {
    const list = ids.split(",").filter((id) => /^\d+$/.test(id)).slice(0, 100);
    const rows = list.length
      ? await d
          .select()
          .from(schema.pots)
          .where(and(eq(schema.pots.scope, scope), inArray(schema.pots.potId, list)))
      : [];
    return Response.json({ pots: rows.map(summary) });
  }

  if (address && isAddress(address)) {
    const a = getAddress(address);
    const rows = await d
      .select()
      .from(schema.pots)
      .where(and(eq(schema.pots.scope, scope), or(eq(schema.pots.organizer, a), eq(schema.pots.payee, a))));
    const claimed = await d
      .select()
      .from(schema.shareClaims)
      .where(and(eq(schema.shareClaims.scope, scope), eq(schema.shareClaims.address, a)));
    const extraIds = claimed.map((c) => c.potId).filter((id) => !rows.some((r) => r.potId === id));
    const extra = extraIds.length
      ? await d
          .select()
          .from(schema.pots)
          .where(and(eq(schema.pots.scope, scope), inArray(schema.pots.potId, extraIds)))
      : [];
    return Response.json({ pots: [...rows, ...extra].map(summary) });
  }

  return fail("Missing query.");
}

function summary(r: typeof schema.pots.$inferSelect) {
  return {
    potId: r.potId,
    slug: r.slug,
    title: r.bill.title,
    category: r.bill.category,
    payeeName: r.bill.payeeName,
    organizer: r.organizer,
    payee: r.payee,
  };
}

async function metaFor(row: typeof schema.pots.$inferSelect): Promise<PotMeta> {
  const d = await db();
  const claims = await d
    .select()
    .from(schema.shareClaims)
    .where(and(eq(schema.shareClaims.scope, row.scope), eq(schema.shareClaims.potId, row.potId)));
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
    .where(and(eq(schema.pots.scope, scopeOf(net.key)!), eq(schema.pots.potId, body.potId)));
  if (existing) return Response.json({ slug: existing.slug });

  const row = {
    scope: scopeOf(net.key)!,
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
