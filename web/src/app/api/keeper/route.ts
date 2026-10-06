import { automationAbi, kinpotAbi } from "@/lib/abi";
import { networks, publicClient, type NetworkKey } from "@/lib/networks";
import { submit } from "@/lib/relayer";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Fallback keeper (Vercel Cron). Chainlink CRE normally pays due pots and refunds expired ones;
 * this does the same through the relayer so nothing waits if the workflow is down.
 * `release` and `refund` are permissionless, so this needs no extra trust.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const results: Record<string, { released: string[]; refunded: string[]; failed: string[] }> = {};
  const keys = (Object.keys(networks) as NetworkKey[]).filter(
    (k) => networks[k].deployment && (k !== "local" || process.env.NODE_ENV !== "production"),
  );

  for (const key of keys) {
    const d = networks[key].deployment!;
    const out = (results[key] = { released: [] as string[], refunded: [] as string[], failed: [] as string[] });
    const count = await publicClient(key).readContract({ address: d.kinpot, abi: kinpotAbi, functionName: "potCount" });
    // Scan the most recent 500 pots: older ones are long settled.
    const from = count > 500n ? count - 499n : 1n;
    const [releaseIds, refundIds] = await publicClient(key).readContract({
      address: d.automation,
      abi: automationAbi,
      functionName: "pending",
      args: [from, 500n],
    });
    for (const [ids, fn, list] of [
      [releaseIds, "release", out.released],
      [refundIds, "refund", out.refunded],
    ] as const) {
      for (const id of ids) {
        try {
          await submit(key, { address: d.kinpot, abi: kinpotAbi, functionName: fn, args: [id] });
          list.push(id.toString());
        } catch {
          out.failed.push(`${fn}:${id}`);
        }
      }
    }
  }
  return Response.json(results);
}
