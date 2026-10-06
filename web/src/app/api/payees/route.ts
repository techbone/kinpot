import { desc, eq, ilike, or } from "drizzle-orm";
import { getAddress, isAddress, isHex, verifyTypedData, type Hex } from "viem";

import { db, schema } from "@/lib/db";
import { messageDomain, PAYEE_KINDS, payeeTypes } from "@/lib/messages";
import { isNetworkKey, networks } from "@/lib/networks";

export const runtime = "nodejs";

/** GET ?q=… searches the directory (verified first). GET ?address=… returns one payee. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const d = await db();
  const address = url.searchParams.get("address");
  if (address) {
    if (!isAddress(address)) return Response.json({ payee: null });
    const [row] = await d.select().from(schema.payees).where(eq(schema.payees.address, getAddress(address)));
    return Response.json({ payee: row ?? null });
  }
  const q = (url.searchParams.get("q") ?? "").trim();
  const rows = await d
    .select()
    .from(schema.payees)
    .where(q ? or(ilike(schema.payees.name, `%${q}%`), ilike(schema.payees.city, `%${q}%`)) : undefined)
    .orderBy(desc(schema.payees.verified), schema.payees.name)
    .limit(20);
  return Response.json({ payees: rows });
}

/** A school, hospital or landlord registers its own address. Starts unverified. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, string> | null;
  if (!body || !isNetworkKey(body.network) || !isAddress(body.address) || !isHex(body.signature)) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const name = String(body.name ?? "").trim();
  const city = String(body.city ?? "").trim();
  const kind = String(body.kind ?? "");
  if (!name || name.length > 80 || !city || city.length > 40 || !(kind in PAYEE_KINDS)) {
    return Response.json({ error: "Fill in the name, type and city." }, { status: 400 });
  }
  const valid = await verifyTypedData({
    address: body.address,
    domain: messageDomain(networks[body.network].chain.id),
    types: payeeTypes,
    primaryType: "PayeeRegistration",
    message: { account: body.address, name, kind, city },
    signature: body.signature as Hex,
  });
  if (!valid) return Response.json({ error: "Bad signature." }, { status: 401 });
  const d = await db();
  const address = getAddress(body.address);
  // Re-registering keeps the verified flag, but a changed name has to be re-verified.
  const [existing] = await d.select().from(schema.payees).where(eq(schema.payees.address, address));
  if (existing) {
    await d
      .update(schema.payees)
      .set({ name, kind, city, verified: existing.verified && existing.name === name })
      .where(eq(schema.payees.address, address));
  } else {
    await d.insert(schema.payees).values({ address, name, kind, city });
  }
  return Response.json({ ok: true });
}
