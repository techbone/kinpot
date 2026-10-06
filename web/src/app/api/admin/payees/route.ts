import { getAddress, isAddress } from "viem";

import { db, schema } from "@/lib/db";
import { PAYEE_KINDS } from "@/lib/messages";

export const runtime = "nodejs";

/** Kinpot staff add or verify a payee. Bearer ADMIN_TOKEN. */
export async function POST(req: Request) {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.headers.get("authorization") !== `Bearer ${token}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.address !== "string" || !isAddress(body.address)) {
    return Response.json({ error: "Invalid address." }, { status: 400 });
  }
  const kind = String(body.kind ?? "other");
  if (!(kind in PAYEE_KINDS)) return Response.json({ error: "Invalid kind." }, { status: 400 });
  const row = {
    address: getAddress(body.address),
    name: String(body.name ?? "").trim(),
    kind,
    city: String(body.city ?? "").trim(),
    verified: body.verified !== false,
  };
  if (!row.name || !row.city) return Response.json({ error: "Name and city are required." }, { status: 400 });
  const d = await db();
  await d
    .insert(schema.payees)
    .values(row)
    .onConflictDoUpdate({ target: schema.payees.address, set: { name: row.name, kind, city: row.city, verified: row.verified } });
  return Response.json({ ok: true, payee: row });
}
