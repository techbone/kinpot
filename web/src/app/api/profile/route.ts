import { eq } from "drizzle-orm";
import { getAddress, isAddress, isHex, verifyTypedData, type Hex } from "viem";

import { db, schema } from "@/lib/db";
import { messageDomain, profileTypes } from "@/lib/messages";
import { isNetworkKey, networks } from "@/lib/networks";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  if (!address || !isAddress(address)) return Response.json({ name: null });
  const d = await db();
  const [row] = await d.select().from(schema.profiles).where(eq(schema.profiles.address, getAddress(address)));
  return Response.json({ name: row?.name ?? null });
}

/** Sets the display name for the signer's address. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, string> | null;
  if (!body || !isNetworkKey(body.network) || !isAddress(body.address) || !isHex(body.signature)) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const name = String(body.name ?? "").trim();
  if (!name || name.length > 40) return Response.json({ error: "Use a name up to 40 characters." }, { status: 400 });
  const valid = await verifyTypedData({
    address: body.address,
    domain: messageDomain(networks[body.network].chain.id),
    types: profileTypes,
    primaryType: "Profile",
    message: { account: body.address, name },
    signature: body.signature as Hex,
  });
  if (!valid) return Response.json({ error: "Bad signature." }, { status: 401 });
  const d = await db();
  const address = getAddress(body.address);
  await d
    .insert(schema.profiles)
    .values({ address, name })
    .onConflictDoUpdate({ target: schema.profiles.address, set: { name } });
  return Response.json({ ok: true });
}
