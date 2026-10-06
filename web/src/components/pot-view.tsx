"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CalendarClock, Check, CircleDashed, ExternalLink, HandCoins, Link2, ShieldCheck, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Address, TypedDataDefinition } from "viem";

import { cancelPot, claimRefund, confirmBill, contribute, declineBill, faucet, triggerRefund, triggerRelease } from "@/lib/actions";
import { CATEGORIES } from "@/lib/bill";
import { formatDate, formatDateTime, formatDue, formatUsd, parseUsd, relativeTime, shortAddress } from "@/lib/format";
import { errorMessage, useNow } from "@/lib/hooks";
import { phaseOf, type Phase } from "@/lib/kinpot";
import { messageDomain, PAYEE_KINDS, shareClaimTypes, type PayeeKind } from "@/lib/messages";
import { explorerUrl, networks, type NetworkKey } from "@/lib/networks";
import { useNaira } from "@/lib/use-fx";
import { usePot, type PotData } from "@/lib/use-pot";
import { ActivityFeed } from "./activity";
import { PhasePill } from "./phase";
import { useAccount, useNetwork } from "./providers";
import { SignInGate } from "./sign-in";
import { Button, Card, CopyButton, cx, Input, Notice, Progress, SectionTitle, Skeleton } from "./ui";
import { useAusdBalance } from "./wallet-panel";

export function PotView({ network, potId }: { network: NetworkKey; potId: bigint }) {
  const query = usePot(network, potId);
  const now = useNow();
  const { network: selected, setNetwork } = useNetwork();

  // A shared link decides the network, so balances and signatures match the pot.
  useEffect(() => {
    if (selected.key !== network) setNetwork(network);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

  if (query.isLoading) return <PotSkeleton />;
  if (query.error) return <div className="pt-10"><Notice tone="danger">Couldn't load this pot: {errorMessage(query.error)}</Notice></div>;
  if (!query.data?.pot) {
    return (
      <div className="pt-16 text-center">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Pot not found</h1>
        <p className="mt-2 text-sm text-muted">There's no pot #{potId.toString()} on {networks[network].label}. Check the link, or the network switch above.</p>
      </div>
    );
  }
  return <PotLoaded network={network} data={query.data} now={now} />;
}

function PotLoaded({ network, data, now }: { network: NetworkKey; data: PotData; now: number }) {
  const pot = data.pot!;
  const { meta, contributions } = data;
  const phase = phaseOf(pot, now);
  const payeeName = meta?.payee?.name ?? meta?.bill.payeeName ?? shortAddress(pot.payee);
  const title = meta?.bill.title ?? `Pot #${pot.id}`;
  const names = meta?.names ?? {};
  const nameOf = (a: Address) => names[a] ?? shortAddress(a);
  const left = pot.target - pot.raised;
  const naira = useNaira();

  return (
    <div className="pt-8 sm:pt-12">
      {/* Phone order: summary, then the action (why they opened the link), then the detail. */}
      <div className="grid gap-8 lg:grid-cols-[1fr_340px] lg:gap-x-8 lg:gap-y-0">
        <div className="min-w-0 lg:col-start-1">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span>{meta ? CATEGORIES[meta.bill.category] : "Bill"}</span>
            <span className="text-faint">·</span>
            <span>Started by {nameOf(pot.organizer)}</span>
          </div>
          <h1 className="font-display text-[28px] leading-tight font-semibold tracking-[-0.02em] sm:text-[34px]">{title}</h1>
          <PayeeLine data={data} payeeName={payeeName} network={network} />

          <Card className="mt-6 p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="num text-[32px] leading-none font-medium sm:text-[40px]">{formatUsd(pot.raised)}</div>
                <div className="mt-2 text-sm text-muted">
                  of <span className="num text-ink">{formatUsd(pot.target)}</span>
                  {naira(pot.target) && <span className="num text-faint"> ({naira(pot.target)})</span>}
                  {left > 0n && phase === "collecting" && <> · <span className="num">{formatUsd(left)}</span> to go</>}
                </div>
              </div>
              <PhasePill phase={phase} pot={pot} />
            </div>
            <div className="mt-5">
              <Progress value={pot.raised} max={pot.target} tone={phase === "paid" ? "ok" : "accent"} />
            </div>
            <Checklist data={data} now={now} payeeName={payeeName} />
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <ActionPanel network={network} data={data} phase={phase} payeeName={payeeName} />
          <SharePanel data={data} network={network} title={title} />
        </aside>

        <div className="min-w-0 lg:col-start-1">
          <Shares data={data} nameOf={nameOf} />
          <ActivityFeed network={network} potId={pot.id} nameOf={nameOf} payeeName={payeeName} />
          <Details data={data} network={network} />
        </div>
      </div>
    </div>
  );
}

function PayeeLine({ data, payeeName, network }: { data: PotData; payeeName: string; network: NetworkKey }) {
  const payee = data.meta?.payee;
  const href = explorerUrl(network, "address", data.pot!.payee);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px]">
      <span className="text-muted">Pays</span>
      <span className="font-medium">{payeeName}</span>
      {payee?.verified && (
        <span className="inline-flex items-center gap-1 text-[13px] text-accent">
          <BadgeCheck className="size-4" /> Verified {PAYEE_KINDS[payee.kind as PayeeKind]?.toLowerCase() ?? "payee"}
        </span>
      )}
      {payee?.city && <span className="text-[13px] text-muted">· {payee.city}</span>}
      {href && (
        <a href={href} target="_blank" rel="noreferrer" className="num text-xs text-faint hover:text-muted">
          {shortAddress(data.pot!.payee)}
        </a>
      )}
    </div>
  );
}

/** The three conditions the contract checks before it pays, shown as they are right now. */
function Checklist({ data, now, payeeName }: { data: PotData; now: number; payeeName: string }) {
  const pot = data.pot!;
  const funded = pot.raised === pot.target;
  const due = now >= pot.dueAt;
  const closed = pot.status === "Closed" || pot.refunded || (pot.status === "Open" && now > pot.expiresAt);

  if (pot.status === "Paid") {
    return (
      <div className="mt-5 flex items-start gap-3 rounded-lg bg-ok-soft p-3 text-[13px] text-ok">
        <Check className="mt-0.5 size-4 shrink-0" />
        <span>
          <span className="num">{formatUsd(pot.target)}</span> went straight to {payeeName}. Nobody in between touched it.
        </span>
      </div>
    );
  }
  if (closed) {
    return (
      <div className="mt-5 flex items-start gap-3 rounded-lg bg-warn-soft p-3 text-[13px] text-warn">
        <Undo2 className="mt-0.5 size-4 shrink-0" />
        <span>
          {pot.refunded
            ? "This pot closed. Everyone got back exactly what they put in."
            : pot.status === "Closed"
              ? "This pot was called off. Everyone gets back exactly what they put in."
              : `The pot closed on ${formatDate(pot.expiresAt)} without paying. Everyone gets back exactly what they put in.`}
        </span>
      </div>
    );
  }

  const rows: { done: boolean; label: string; detail: string }[] = [
    { done: funded, label: "Bill covered", detail: funded ? "Fully funded" : `${formatUsd(pot.target - pot.raised)} still to raise` },
    {
      done: pot.payeeConfirmed,
      label: `${payeeName} confirmed the bill`,
      detail: pot.payeeConfirmed ? "The payee says this bill is real" : "Waiting for the payee to confirm",
    },
    {
      done: due,
      label: due ? "Due date reached" : `Due ${formatDue(pot.dueAt, now)}`,
      detail: due ? formatDateTime(pot.dueAt) : relativeTime(pot.dueAt, now),
    },
  ];
  return (
    <ul className="mt-6 space-y-3 border-t border-line pt-5">
      {rows.map((r) => (
        <li key={r.label} className="flex items-start gap-3">
          {r.done ? (
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-ok text-paper">
              <Check className="size-3" strokeWidth={3} />
            </span>
          ) : (
            <CircleDashed className="mt-0.5 size-5 shrink-0 text-faint" />
          )}
          <div className="min-w-0">
            <div className={cx("text-sm", r.done ? "text-ink" : "text-muted")}>{r.label}</div>
            <div className="text-xs text-faint">{r.detail}</div>
          </div>
        </li>
      ))}
      <li className="pl-8 text-xs text-muted">
        When all three are ticked, the money goes to the payee. If the pot isn't paid by {formatDue(pot.expiresAt, now)}, everyone is refunded.
      </li>
    </ul>
  );
}

function Shares({ data, nameOf }: { data: PotData; nameOf: (a: Address) => string }) {
  const names = data.meta?.names ?? {};
  const shares = data.meta?.bill.shares ?? [];
  const claims = data.meta?.claims ?? [];
  const byAddress = new Map(data.contributions.map((c) => [c.contributor, c]));
  const claimedAddresses = new Set(claims.map((c) => c.address));
  const unlinked = data.contributions.filter((c) => !claimedAddresses.has(c.contributor));

  if (shares.length === 0 && data.contributions.length === 0) return null;

  return (
    <section className="lg:mt-8">
      <SectionTitle aside={<span className="text-xs text-muted">{data.contributions.length} paid in</span>}>Who's chipping in</SectionTitle>
      <Card className="divide-y divide-line">
        {shares.map((share, i) => {
          const claim = claims.find((c) => c.shareIndex === i);
          const paid = claim ? byAddress.get(claim.address)?.amount ?? 0n : 0n;
          const expected = BigInt(share.amount);
          return (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={share.name} done={paid > 0n} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{share.name}</div>
                <div className="text-xs text-muted">{claim ? `Paid from ${shortAddress(claim.address)}` : "Not paid yet"}</div>
              </div>
              <div className="text-right">
                <div className="num text-sm">{formatUsd(paid)}</div>
                <div className="num text-xs text-faint">of {formatUsd(expected)}</div>
              </div>
            </div>
          );
        })}
        {unlinked.map((c) => (
          <div key={c.contributor} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={nameOf(c.contributor)} done />
            <div className="min-w-0 flex-1">
              <div className={cx("text-sm font-medium", !names[c.contributor] && "num")}>{nameOf(c.contributor)}</div>
              <div className="text-xs text-muted">{names[c.contributor] ? shortAddress(c.contributor) : "Chipped in"}</div>
            </div>
            <div className="num text-sm">{formatUsd(c.amount)}</div>
          </div>
        ))}
      </Card>
    </section>
  );
}

function Avatar({ name, done }: { name: string; done: boolean }) {
  return (
    <span
      className={cx(
        "grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold uppercase",
        done ? "bg-ok-soft text-ok" : "bg-sunk text-faint",
      )}
    >
      {name.startsWith("0x") ? "·" : name.slice(0, 1)}
    </span>
  );
}

function Details({ data, network }: { data: PotData; network: NetworkKey }) {
  const pot = data.pot!;
  const bill = data.meta?.bill;
  const contract = networks[network].deployment?.kinpot;
  const contractHref = contract ? explorerUrl(network, "address", contract) : undefined;
  return (
    <section className="mt-8">
      <SectionTitle>Bill details</SectionTitle>
      <Card className="p-4 text-sm">
        <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2.5">
          {bill?.reference && (
            <>
              <dt className="text-muted">Reference</dt>
              <dd>{bill.reference}</dd>
            </>
          )}
          {bill?.note && (
            <>
              <dt className="text-muted">Note</dt>
              <dd className="whitespace-pre-line">{bill.note}</dd>
            </>
          )}
          <dt className="text-muted">Due</dt>
          <dd>{formatDateTime(pot.dueAt)}</dd>
          <dt className="text-muted">Refund after</dt>
          <dd>{formatDateTime(pot.expiresAt)}</dd>
          <dt className="text-muted">Record</dt>
          <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {data.verified ? (
              <span className="inline-flex items-center gap-1 text-ok">
                <ShieldCheck className="size-4" /> Details match the onchain record
              </span>
            ) : (
              <span className="text-warn">No matching details stored</span>
            )}
            {contractHref && (
              <a href={contractHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
                Pot #{pot.id.toString()} <ExternalLink className="size-3" />
              </a>
            )}
          </dd>
        </dl>
      </Card>
    </section>
  );
}

function SharePanel({ data, network, title }: { data: PotData; network: NetworkKey; title: string }) {
  const url = useMemo(() => {
    if (typeof window === "undefined") return "";
    const path = data.meta ? `/p/${data.meta.slug}` : `/pot/${network}/${data.pot!.id}`;
    return `${window.location.origin}${path}`;
  }, [data.meta, data.pot, network]);
  if (!url || data.pot!.status !== "Open") return null;
  const pot = data.pot!;
  const text = `${title}: ${formatUsd(pot.raised)} of ${formatUsd(pot.target)} raised. It goes straight to the payee. Pay your share here: ${url}`;
  return (
    <Card className="p-4">
      <div className="mb-3 text-sm font-medium">Send to the family group</div>
      <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
        <Button variant="secondary" className="w-full">
          Share on WhatsApp
        </Button>
      </a>
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-sunk px-3 py-2">
        <Link2 className="size-3.5 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted">{url.replace(/^https?:\/\//, "")}</span>
        <CopyButton value={url} />
      </div>
    </Card>
  );
}

// -------------------------------------------------------------------------------------------------
// Actions
// -------------------------------------------------------------------------------------------------

function ActionPanel({ network, data, phase, payeeName }: { network: NetworkKey; data: PotData; phase: Phase; payeeName: string }) {
  const account = useAccount();
  const queryClient = useQueryClient();
  const pot = data.pot!;
  const me = account.address;
  const isPayee = me === pot.payee;
  const isOrganizer = me === pot.organizer;
  const mine = data.contributions.find((c) => c.contributor === me);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; hash?: string } | null>(null);
  const signer = me ? { address: me, signTypedData: account.signTypedData } : null;

  async function run(key: string, fn: () => Promise<{ hash: string } | void>, doneText: string) {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      const result = await fn();
      setDone({ text: doneText, hash: result ? result.hash : undefined });
      await queryClient.invalidateQueries({ queryKey: ["pot", network, pot.id.toString()] });
      await queryClient.invalidateQueries({ queryKey: ["ausd-balance"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const feedback = (
    <>
      {error && <div className="mt-3"><Notice tone="danger">{error}</Notice></div>}
      {done && (
        <div className="mt-3">
          <Notice tone="ok">
            {done.text}{" "}
            {done.hash && explorerUrl(network, "tx", done.hash) && (
              <a className="underline underline-offset-2" href={explorerUrl(network, "tx", done.hash)} target="_blank" rel="noreferrer">
                View receipt
              </a>
            )}
          </Notice>
        </div>
      )}
    </>
  );

  // Anyone can push a finished pot over the line. Kinpot's keeper normally does this for you.
  if (phase === "ready") {
    return (
      <Card className="p-4">
        <div className="text-sm font-medium">Ready to pay {payeeName}</div>
        <p className="mt-1 text-[13px] text-muted">Covered, confirmed and due. It pays automatically within a few minutes, or you can send it now.</p>
        <Button size="lg" className="mt-4 w-full" disabled={busy !== null} onClick={() => run("release", () => triggerRelease(network, pot.id), `Paid ${formatUsd(pot.target)} to ${payeeName}.`)}>
          {busy === "release" ? "Paying…" : `Pay ${formatUsd(pot.target)} now`}
        </Button>
        {feedback}
      </Card>
    );
  }

  if (phase === "refunding") {
    return (
      <Card className="p-4">
        <div className="text-sm font-medium">Refunds are due</div>
        <p className="mt-1 text-[13px] text-muted">Each person gets back exactly what they put in.</p>
        <Button size="lg" className="mt-4 w-full" disabled={busy !== null} onClick={() => run("refund", () => triggerRefund(network, pot.id), "Refunds sent.")}>
          {busy === "refund" ? "Sending…" : "Send refunds now"}
        </Button>
        {feedback}
      </Card>
    );
  }

  if (mine && mine.refundOwed > 0n && signer) {
    return (
      <Card className="p-4">
        <div className="text-sm font-medium">Your refund is waiting</div>
        <p className="mt-1 text-[13px] text-muted">We couldn't send it automatically. Claim it here.</p>
        <Button size="lg" className="mt-4 w-full" disabled={busy !== null} onClick={() => run("claim", () => claimRefund(network, signer, pot.id), "Refund claimed.")}>
          Claim {formatUsd(mine.refundOwed)}
        </Button>
        {feedback}
      </Card>
    );
  }

  if (pot.status !== "Open") {
    return (
      <Card className="p-4 text-[13px] text-muted">
        {pot.status === "Paid" ? `This bill is paid. ${payeeName} received ${formatUsd(pot.target)}.` : "This pot is closed."}
        {mine && <div className="mt-2">You put in <span className="num text-ink">{formatUsd(mine.amount)}</span>.</div>}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {isPayee && signer && (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <HandCoins className="size-4 text-accent" /> This bill is addressed to you
          </div>
          {pot.payeeConfirmed ? (
            <p className="mt-2 text-[13px] text-muted">You've confirmed it. You'll receive {formatUsd(pot.target)} once it's covered and due.</p>
          ) : (
            <>
              <p className="mt-2 text-[13px] text-muted">
                Confirm only if {data.meta?.bill.reference ? <>“{data.meta.bill.reference}”</> : "this bill"} is real and the amount of{" "}
                <span className="num text-ink">{formatUsd(pot.target)}</span> is right. The family can see your confirmation.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button disabled={busy !== null} onClick={() => run("confirm", () => confirmBill(network, signer, pot.id), "Bill confirmed.")}>
                  {busy === "confirm" ? "Confirming…" : "Confirm bill"}
                </Button>
                <Button
                  variant="danger"
                  disabled={busy !== null}
                  onClick={() => window.confirm("Decline this bill? The pot closes and everyone is refunded.") && run("decline", () => declineBill(network, signer, pot.id), "Bill declined. Everyone will be refunded.")}
                >
                  Decline
                </Button>
              </div>
            </>
          )}
          {feedback}
        </Card>
      )}

      {!isPayee && phase === "collecting" && <PayShare network={network} data={data} />}

      {!isPayee && phase !== "collecting" && (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="size-4 text-accent" /> Fully covered
          </div>
          <p className="mt-1 text-[13px] text-muted">
            {pot.payeeConfirmed
              ? `It pays ${payeeName} on ${formatDate(pot.dueAt)}.`
              : `Waiting for ${payeeName} to confirm the bill. If they don't by ${formatDate(pot.expiresAt)}, everyone is refunded.`}
          </p>
          {mine && <p className="mt-2 text-[13px] text-muted">You put in <span className="num text-ink">{formatUsd(mine.amount)}</span>.</p>}
        </Card>
      )}

      {isOrganizer && signer && (
        <button
          type="button"
          disabled={busy !== null}
          className="w-full text-center text-xs text-muted hover:text-danger"
          onClick={() => window.confirm("Call off this pot? Everyone gets back what they put in.") && run("cancel", () => cancelPot(network, signer, pot.id), "Pot called off. Refunds are on the way.")}
        >
          {busy === "cancel" ? "Calling off…" : "Call off this pot"}
        </button>
      )}
      {!isPayee && feedback}
    </div>
  );
}

function PayShare({ network, data }: { network: NetworkKey; data: PotData }) {
  const account = useAccount();
  const queryClient = useQueryClient();
  const balance = useAusdBalance();
  const pot = data.pot!;
  const left = pot.target - pot.raised;
  const shares = data.meta?.bill.shares ?? [];
  const claimed = new Set((data.meta?.claims ?? []).map((c) => c.shareIndex));
  const open = shares.map((s, i) => ({ ...s, i })).filter((s) => !claimed.has(s.i));
  const [shareIndex, setShareIndex] = useState<number | null>(open[0]?.i ?? null);
  const suggested = shareIndex !== null ? BigInt(shares[shareIndex].amount) : left;
  const [input, setInput] = useState<string | null>(null);
  const amount = input === null ? (suggested < left ? suggested : left) : parseUsd(input);
  const [busy, setBusy] = useState<"pay" | "faucet" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState<string | null>(null);

  const short = amount !== null && balance.data !== undefined && balance.data < amount;
  const tooMuch = amount !== null && amount > left;
  const mock = networks[network].deployment?.mockAusd;

  async function pay() {
    if (!account.address || amount === null) return;
    setBusy("pay");
    setError(null);
    try {
      const signer = { address: account.address, signTypedData: account.signTypedData };
      const result = await contribute(network, signer, pot.id, amount);
      if (shareIndex !== null) {
        const signature = await account.signTypedData({
          domain: messageDomain(networks[network].chain.id),
          types: shareClaimTypes,
          primaryType: "ShareClaim",
          message: { account: account.address, potId: pot.id, shareIndex: BigInt(shareIndex) },
        } as TypedDataDefinition);
        await fetch("/api/claims", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ network, potId: pot.id.toString(), shareIndex, address: account.address, signature }),
        });
      }
      setPaid(result.hash);
      setInput(null);
      await queryClient.invalidateQueries({ queryKey: ["pot", network, pot.id.toString()] });
      await queryClient.invalidateQueries({ queryKey: ["ausd-balance"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-4">
      <div className="text-sm font-medium">Pay your share</div>
      <p className="mt-1 text-[13px] text-muted">The money waits in the pot and only goes to the payee. If the bill doesn't go ahead, you get it back.</p>
      <SignInGate prompt="Sign in to pay your share">
        {open.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 text-[13px] font-medium">Which one is you?</div>
            <div className="flex flex-wrap gap-1.5">
              {open.map((s) => (
                <button
                  key={s.i}
                  type="button"
                  onClick={() => {
                    setShareIndex(s.i);
                    setInput(null);
                  }}
                  className={cx(
                    "h-8 rounded-full border px-3 text-[13px] transition-colors",
                    shareIndex === s.i ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:text-ink",
                  )}
                >
                  {s.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setShareIndex(null);
                  setInput(null);
                }}
                className={cx(
                  "h-8 rounded-full border px-3 text-[13px] transition-colors",
                  shareIndex === null ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:text-ink",
                )}
              >
                Someone else
              </button>
            </div>
          </div>
        )}
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
            <span className="font-medium">Amount</span>
            <span className="text-xs text-muted">
              Balance <span className="num">{balance.data === undefined ? "—" : formatUsd(balance.data)}</span>
            </span>
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
            <Input
              inputMode="decimal"
              className="num pl-7 text-base"
              value={input ?? (amount !== null ? (Number(amount) / 1e6).toFixed(2) : "")}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>
          {tooMuch && <p className="mt-1.5 text-xs text-danger">Only {formatUsd(left)} is left to raise.</p>}
        </div>
        {short && !tooMuch && (
          <div className="mt-3">
            <Notice tone="warn">
              You need {formatUsd(amount! - balance.data!)} more.{" "}
              {mock && (
                <button
                  type="button"
                  className="font-medium underline underline-offset-2"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy("faucet");
                    try {
                      await faucet(network, account.address!);
                      await queryClient.invalidateQueries({ queryKey: ["ausd-balance"] });
                    } catch (e) {
                      setError(errorMessage(e));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === "faucet" ? "Adding…" : "Add $500 of test money"}
                </button>
              )}
            </Notice>
          </div>
        )}
        <Button size="lg" className="mt-4 w-full" disabled={busy !== null || amount === null || tooMuch || short} onClick={() => void pay()}>
          {busy === "pay" ? "Paying…" : amount !== null ? `Pay ${formatUsd(amount)}` : "Pay"}
        </Button>
        <p className="mt-2 text-center text-[11px] text-faint">One tap to approve. No fees on testnet.</p>
        {error && <div className="mt-3"><Notice tone="danger">{error}</Notice></div>}
        {paid && (
          <div className="mt-3">
            <Notice tone="ok">
              Paid. Thank you.{" "}
              {explorerUrl(network, "tx", paid) && (
                <a className="underline underline-offset-2" href={explorerUrl(network, "tx", paid)} target="_blank" rel="noreferrer">
                  View receipt
                </a>
              )}
            </Notice>
          </div>
        )}
      </SignInGate>
    </Card>
  );
}

function PotSkeleton() {
  return (
    <div className="grid gap-8 pt-12 lg:grid-cols-[1fr_340px]">
      <div>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-4 h-9 w-3/4" />
        <Skeleton className="mt-3 h-5 w-1/2" />
        <Skeleton className="mt-6 h-56 w-full rounded-xl" />
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
