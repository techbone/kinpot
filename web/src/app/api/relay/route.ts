import { BaseError, ContractFunctionRevertedError, decodeFunctionData, isAddress, isHex, parseSignature, type Address, type Hex } from "viem";

import { forwarderAbi, kinpotAbi, mockAusdAbi } from "@/lib/abi";
import { isNetworkKey, networks, publicClient } from "@/lib/networks";
import { submit } from "@/lib/relayer";

export const runtime = "nodejs";

/** Kinpot functions a user may ask the relayer to forward on their behalf. */
const FORWARDABLE = new Set(["createPot", "confirmBill", "declineBill", "cancel", "claimRefund"]);
const FAUCET_AMOUNT = 500_000_000n; // 500 test AUSD

const ERROR_TEXT: Record<string, string> = {
  InvalidPayee: "That payee address isn't allowed.",
  InvalidAmount: "Enter an amount above zero.",
  InvalidSchedule: "Check the dates: the due date can't be in the past and the pot must close after it.",
  PotNotOpen: "This pot is no longer open.",
  PotExpired: "This pot has expired.",
  ExceedsRemaining: "That's more than what's left to raise.",
  TooManyContributors: "This pot already has the maximum number of contributors.",
  NotPayee: "Only the payee can do that.",
  NotOrganizer: "Only the person who started the pot can do that.",
  NotReleasable: "This pot can't be paid yet.",
  NotRefundable: "This pot can't be refunded.",
  NothingOwed: "There's nothing to claim.",
  AuthorizationUsedAlready: "That signature was already used. Try again.",
  AuthorizationExpired: "The signature expired. Try again.",
  InvalidSignature: "The signature didn't match. Try again.",
  ERC2771ForwarderExpiredRequest: "The request expired. Try again.",
  ERC2771ForwarderInvalidSigner: "The signature didn't match. Try again.",
};

// Best-effort, per-instance rate limit. Moves to Postgres with the relay log in M3.
const hits = new Map<string, number[]>();
function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function explain(error: unknown): string {
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && ERROR_TEXT[name]) return ERROR_TEXT[name];
      if (name) return `The contract refused: ${name}.`;
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : "The request failed.";
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid request.");
  }

  const network = body.network;
  if (!isNetworkKey(network)) return fail("Unknown network.");
  if (network === "local" && process.env.NODE_ENV === "production") return fail("Unknown network.");
  const d = networks[network].deployment;
  if (!d) return fail(`Kinpot isn't deployed on ${networks[network].label} yet.`);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(`ip:${ip}`, 30, 60_000)) return fail("Too many requests. Wait a minute and try again.", 429);

  try {
    switch (body.action) {
      case "forward": {
        const r = body.request as Record<string, string> | undefined;
        if (!r || !isAddress(r.from) || !isHex(r.data) || !isHex(r.signature)) return fail("Invalid request.");
        if (r.to?.toLowerCase() !== d.kinpot.toLowerCase()) return fail("That target isn't allowed.");
        if (BigInt(r.value) !== 0n) return fail("Value transfers aren't allowed.");
        const { functionName, args } = decodeFunctionData({ abi: kinpotAbi, data: r.data as Hex });
        if (!FORWARDABLE.has(functionName)) return fail("That action isn't allowed.");
        if (rateLimited(`from:${r.from}`, 10, 60_000)) return fail("Too many requests. Wait a minute.", 429);
        // The forwarder swallows the inner revert reason, so first simulate the call as the user
        // directly: `_msgSender()` is the same either way, and the error stays readable.
        await publicClient(network).simulateContract({
          address: d.kinpot,
          abi: kinpotAbi,
          functionName,
          args,
          account: r.from as Address,
        } as never);

        const request = {
          from: r.from as Address,
          to: r.to as Address,
          value: 0n,
          gas: BigInt(r.gas),
          deadline: Number(r.deadline),
          data: r.data as Hex,
          signature: r.signature as Hex,
        };
        const valid = await publicClient(network).readContract({
          address: d.forwarder,
          abi: forwarderAbi,
          functionName: "verify",
          args: [request],
        });
        if (!valid) return fail("The signature didn't match. Try again.");
        return Response.json(
          await submit(network, { address: d.forwarder, abi: forwarderAbi, functionName: "execute", args: [request] }),
        );
      }

      case "contribute": {
        const { potId, from, amount, validAfter, validBefore, salt, signature } = body as Record<string, string>;
        if (!isAddress(from) || !isHex(salt) || !isHex(signature)) return fail("Invalid request.");
        if (rateLimited(`from:${from}`, 10, 60_000)) return fail("Too many requests. Wait a minute.", 429);
        const sig = parseSignature(signature as Hex);
        const v = sig.v !== undefined ? Number(sig.v) : 27 + (sig.yParity ?? 0);
        return Response.json(
          await submit(network, {
            address: d.kinpot,
            abi: kinpotAbi,
            functionName: "contributeWithAuthorization",
            args: [BigInt(potId), from, BigInt(amount), BigInt(validAfter), BigInt(validBefore), salt, v, sig.r, sig.s],
          }),
        );
      }

      case "release":
      case "refund": {
        const potId = BigInt(String(body.potId));
        const check = body.action === "release" ? "canRelease" : "canRefund";
        const ok = await publicClient(network).readContract({
          address: d.kinpot,
          abi: kinpotAbi,
          functionName: check,
          args: [potId],
        });
        if (!ok) return fail(body.action === "release" ? ERROR_TEXT.NotReleasable : ERROR_TEXT.NotRefundable);
        return Response.json(
          await submit(network, { address: d.kinpot, abi: kinpotAbi, functionName: body.action, args: [potId] }),
        );
      }

      case "faucet": {
        if (!d.mockAusd) return fail("The faucet is only on testnet.");
        const to = String(body.to);
        if (!isAddress(to)) return fail("Invalid address.");
        if (rateLimited(`faucet:${to}`, 3, 60 * 60_000)) return fail("You've used the faucet a lot. Try again in an hour.", 429);
        return Response.json(
          await submit(network, { address: d.ausd, abi: mockAusdAbi, functionName: "mint", args: [to, FAUCET_AMOUNT] }),
        );
      }

      default:
        return fail("Unknown action.");
    }
  } catch (error) {
    return fail(explain(error), 422);
  }
}
