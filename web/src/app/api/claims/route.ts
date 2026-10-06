import { and, eq } from "drizzle-orm";
import { getAddress, isAddress, isHex, verifyTypedData, type Hex } from "viem";

import { kinpotAbi } from "@/lib/abi";
import { db, schema } from "@/lib/db";
import { messageDomain, shareClaimTypes } from "@/lib/messages";
import { isNetworkKey, networks, publicClient, scopeOf } from "@/lib/networks";

export const runtime = "nodejs";

/** "I'm Kemi": links a named share to the signer, once they have contributed to the pot. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !isNetworkKey(body.network)) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { potId, shareIndex, address, signature } = body as Record<string, string>;
  if (!/^\d+$/.test(String(potId)) || !Number.isInteger(Number(shareIndex)) || !isAddress(address) || !isHex(signature)) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const net = networks[body.network];
  if (!net.deployment) return Response.json({ error: "Not deployed on this network." }, { status: 400 });

  const valid = await verifyTypedData({
    address,
    domain: messageDomain(net.chain.id),
    types: shareClaimTypes,
    primaryType: "ShareClaim",
    message: { account: address, potId: BigInt(potId), shareIndex: BigInt(shareIndex) },
    signature: signature as Hex,
  });
  if (!valid) return Response.json({ error: "Bad signature." }, { status: 401 });

  const contributed = await publicClient(net.key).readContract({
    address: net.deployment.kinpot,
    abi: kinpotAbi,
    functionName: "contributed",
    args: [BigInt(potId), address],
  });
  if (contributed === 0n) return Response.json({ error: "Pay into the pot first." }, { status: 422 });

  const d = await db();
  const [row] = await d
    .select()
    .from(schema.pots)
    .where(and(eq(schema.pots.scope, scopeOf(net.key)!), eq(schema.pots.potId, String(potId))));
  if (!row || Number(shareIndex) >= row.bill.shares.length) {
    return Response.json({ error: "Unknown share." }, { status: 404 });
  }
  await d
    .insert(schema.shareClaims)
    .values({ scope: scopeOf(net.key)!, potId: String(potId), shareIndex: Number(shareIndex), address: getAddress(address) })
    .onConflictDoNothing();
  return Response.json({ ok: true });
}
