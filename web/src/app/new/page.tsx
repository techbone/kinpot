"use client";

import { BadgeCheck, Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";

import { useAccount, useNetwork } from "@/components/providers";
import { SignInGate } from "@/components/sign-in";
import { Button, Card, cx, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { createPot } from "@/lib/actions";
import { billHash, CATEGORIES, type Bill, type Category } from "@/lib/bill";
import { formatDate, formatUsd, parseUsd } from "@/lib/format";
import { errorMessage } from "@/lib/hooks";
import { PAYEE_KINDS, type PayeeKind } from "@/lib/messages";
import { publicClient } from "@/lib/networks";
import { useNaira } from "@/lib/use-fx";

type Payee = { address: Address; name: string; kind: string; city: string; verified: boolean };
type ShareRow = { name: string; amount: string };

const DAY = 86_400;

function todayPlus(days: number) {
  const d = new Date(Date.now() + days * DAY * 1000);
  return d.toISOString().slice(0, 10);
}

export default function NewPotPage() {
  const router = useRouter();
  const account = useAccount();
  const { network } = useNetwork();
  const demoAvailable = Boolean(network.deployment?.mockAusd);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("school");
  const [payee, setPayee] = useState<Payee | null>(null);
  const [amount, setAmount] = useState("");
  const [timing, setTiming] = useState<"date" | "asap" | "demo">("date");
  const [dueDate, setDueDate] = useState(todayPlus(14));
  const [graceDays, setGraceDays] = useState(30);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (account.name && shares.length === 0) setShares([{ name: account.name, amount: "" }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.name]);

  const target = parseUsd(amount);
  const naira = useNaira();
  const shareAmounts = shares.map((s) => (s.amount.trim() ? parseUsd(s.amount) : null));
  const shareTotal = shareAmounts.reduce<bigint>((sum, a) => sum + (a ?? 0n), 0n);
  const sharesUsed = shares.some((s) => s.name.trim());
  const sharesOk = !sharesUsed || (target !== null && shareTotal === target && shares.every((s, i) => s.name.trim() && shareAmounts[i] !== null));

  const scheduleAt = (now: number) => {
    if (timing === "demo") return { dueAt: now + 180, expiresAt: now + 15 * 60 };
    if (timing === "asap") return { dueAt: now + 120, expiresAt: now + 120 + graceDays * DAY };
    const [y, m, d] = dueDate.split("-").map(Number);
    const due = Math.max(Math.floor(new Date(y, m - 1, d, 9).getTime() / 1000), now + 120);
    return { dueAt: due, expiresAt: due + graceDays * DAY };
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const schedule = useMemo(() => scheduleAt(Math.floor(Date.now() / 1000)), [timing, dueDate, graceDays]);

  const problems = [
    !title.trim() && "Give the bill a name.",
    !payee && "Choose who gets paid.",
    payee && account.address && payee.address === account.address && "You can't be the payee of your own pot.",
    target === null && "Enter the bill amount.",
    !sharesOk && "Shares need a name each and must add up to the bill amount.",
  ].filter(Boolean) as string[];

  function splitEvenly() {
    if (target === null || shares.length === 0) return;
    const n = BigInt(shares.length);
    const each = target / n;
    const rest = target - each * n;
    setShares(shares.map((s, i) => ({ ...s, amount: ((Number(each + (i === 0 ? rest : 0n))) / 1e6).toFixed(2) })));
  }

  async function submit() {
    if (problems.length || !account.address || !payee || target === null) return;
    setError(null);
    const bill: Bill = {
      v: 1,
      title: title.trim(),
      category,
      payeeName: payee.name,
      reference: reference.trim(),
      note: note.trim(),
      shares: sharesUsed ? shares.map((s, i) => ({ name: s.name.trim(), amount: shareAmounts[i]!.toString() })) : [],
    };
    try {
      setBusy("Waiting for your approval…");
      // Final times come from the chain clock; a phone's clock can be minutes off.
      const final = scheduleAt(Number((await publicClient(network.key).getBlock()).timestamp));
      const signer = { address: account.address, signTypedData: account.signTypedData };
      const result = await createPot(network.key, signer, {
        payee: payee.address,
        target,
        dueAt: final.dueAt,
        expiresAt: final.expiresAt,
        billHash: billHash(bill),
      });
      if (!result.potId) throw new Error("The pot was created but we couldn't read its number. Check your pots list.");
      setBusy("Saving the bill details…");
      const res = await fetch("/api/pots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ network: network.key, potId: result.potId, bill }),
      });
      const json = (await res.json()) as { slug?: string; error?: string };
      if (!res.ok || !json.slug) throw new Error(json.error ?? "Couldn't save the bill details.");
      router.push(`/p/${json.slug}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl pt-10 sm:pt-14">
      <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">Start a pot</h1>
      <p className="mt-2 text-[15px] text-muted">
        One bill, one payee, one due date. The money only moves to the payee, and only when everything checks out.
      </p>

      <div className="mt-8 space-y-6">
        <Card className="space-y-5 p-5 sm:p-6">
          <Field label="What's the bill?">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dayo's school fees, 2nd term" maxLength={120} />
          </Field>
          <div>
            <div className="mb-1.5 text-[13px] font-medium">Type</div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(CATEGORIES) as Category[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cx(
                    "h-8 rounded-full border px-3 text-[13px] transition-colors",
                    category === c ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:text-ink",
                  )}
                >
                  {CATEGORIES[c]}
                </button>
              ))}
            </div>
          </div>
          <PayeePicker value={payee} onChange={setPayee} />
        </Card>

        <Card className="space-y-5 p-5 sm:p-6">
          <Field
            label="Amount"
            hint={
              target !== null && naira(target)
                ? `${naira(target)} at today's rate. Paid in US dollars (AUSD), from wherever each sibling is.`
                : "In US dollars (AUSD). Each sibling pays from wherever they are."
            }
          >
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
              <Input inputMode="decimal" className="num pl-7" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="480.00" />
            </div>
          </Field>
          <div>
            <div className="mb-1.5 text-[13px] font-medium">When should it be paid?</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {(
                [
                  ["date", "On a date"],
                  ["asap", "As soon as it's covered"],
                  ...(demoAvailable ? ([["demo", "Demo: in 3 minutes"]] as const) : []),
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTiming(key)}
                  className={cx(
                    "h-10 rounded-lg border px-3 text-left text-[13px] transition-colors",
                    timing === key ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {timing === "date" && (
            <Field label="Due date">
              <Input type="date" value={dueDate} min={todayPlus(0)} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          )}
          {timing !== "demo" && (
            <Field label="If it isn't paid, refund everyone after" hint={`Refunds start ${formatDate(schedule.expiresAt)} if the payee hasn't been paid by then.`}>
              <Select value={graceDays} onChange={(e) => setGraceDays(Number(e.target.value))}>
                {[7, 14, 30, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    {d} days past the due date
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {timing === "demo" && (
            <Notice tone="accent">Due in 3 minutes, refunds after 15. For trying the whole flow on testnet.</Notice>
          )}
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="mb-1 flex items-baseline justify-between">
            <div className="text-[13px] font-medium">Who's chipping in?</div>
            {shares.length > 1 && target !== null && (
              <button type="button" onClick={splitEvenly} className="text-xs text-accent hover:underline">
                Split evenly
              </button>
            )}
          </div>
          <p className="mb-4 text-xs text-muted">Optional. Everyone sees who has paid their part. Anyone with the link can still chip in.</p>
          <div className="space-y-2">
            {shares.map((s, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={s.name}
                  onChange={(e) => setShares(shares.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                  placeholder={["Tobi", "Kemi", "Femi", "Dayo"][i] ?? "Name"}
                  maxLength={60}
                />
                <div className="relative w-36 shrink-0">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">$</span>
                  <Input
                    inputMode="decimal"
                    className="num pl-7"
                    value={s.amount}
                    onChange={(e) => setShares(shares.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))}
                    placeholder="0.00"
                  />
                </div>
                <Button variant="ghost" className="w-10 shrink-0 px-0" onClick={() => setShares(shares.filter((_, j) => j !== i))} aria-label="Remove">
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <Button variant="secondary" size="sm" onClick={() => setShares([...shares, { name: "", amount: "" }])} disabled={shares.length >= 12}>
              <Plus className="size-4" /> Add person
            </Button>
            {sharesUsed && target !== null && (
              <span className={cx("num text-xs", shareTotal === target ? "text-ok" : "text-muted")}>
                {formatUsd(shareTotal)} of {formatUsd(target)}
              </span>
            )}
          </div>
        </Card>

        <Card className="space-y-5 p-5 sm:p-6">
          <Field label="Reference for the payee" hint="What the school, hospital or landlord needs to match the payment: invoice number, student or patient name.">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="INV-2291 · Dayo Adeyemi · JSS2" maxLength={200} />
          </Field>
          <Field label="Note to the family">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bursary said they need it before resumption on the 15th." maxLength={1000} />
          </Field>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="text-[13px] font-medium">Summary</div>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {target !== null && payee ? (
              <>
                Collect <span className="num text-ink">{formatUsd(target)}</span> for <span className="text-ink">{title.trim() || "this bill"}</span>. Pay{" "}
                <span className="text-ink">{payee.name}</span>{" "}
                {timing === "date" ? <>on {formatDate(schedule.dueAt)}</> : timing === "asap" ? "as soon as it's covered" : "in 3 minutes"}, once they confirm the bill.
                Otherwise refund everyone after {formatDate(schedule.expiresAt)}.
              </>
            ) : (
              "Fill in the bill, payee and amount."
            )}
          </p>
          <div className="mt-5">
            <SignInGate prompt="Sign in to start the pot">
              <Button size="lg" className="w-full" disabled={problems.length > 0 || busy !== null} onClick={() => void submit()}>
                {busy ?? "Start the pot"}
              </Button>
              {problems.length > 0 && <p className="mt-2 text-center text-xs text-muted">{problems[0]}</p>}
            </SignInGate>
          </div>
          {error && (
            <div className="mt-3">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function PayeePicker({ value, onChange }: { value: Payee | null; onChange: (p: Payee | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Payee[]>([]);
  const [manual, setManual] = useState(false);
  const [manualAddress, setManualAddress] = useState("");
  const [manualName, setManualName] = useState("");

  useEffect(() => {
    if (value || manual) return;
    const id = setTimeout(() => {
      fetch(`/api/payees?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((j: { payees: Payee[] }) => setResults(j.payees))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(id);
  }, [q, value, manual]);

  useEffect(() => {
    if (!manual) return;
    if (isAddress(manualAddress) && manualName.trim()) {
      onChange({ address: getAddress(manualAddress), name: manualName.trim(), kind: "other", city: "", verified: false });
    } else onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual, manualAddress, manualName]);

  if (value && !manual) {
    return (
      <div>
        <div className="mb-1.5 text-[13px] font-medium">Who gets paid?</div>
        <div className="flex items-center gap-3 rounded-lg border border-accent bg-accent-soft/40 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              {value.name}
              {value.verified && <BadgeCheck className="size-4 text-accent" />}
            </div>
            <div className="text-xs text-muted">
              {PAYEE_KINDS[value.kind as PayeeKind] ?? "Payee"}
              {value.city && ` · ${value.city}`}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            Change
          </Button>
        </div>
      </div>
    );
  }

  if (manual) {
    return (
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="text-[13px] font-medium">Who gets paid?</div>
          <button type="button" className="text-xs text-accent hover:underline" onClick={() => setManual(false)}>
            Search the directory
          </button>
        </div>
        <Input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Mr Okafor (landlord)" maxLength={120} />
        <Input value={manualAddress} onChange={(e) => setManualAddress(e.target.value)} placeholder="Their Kinpot address, 0x…" className="num" />
        <Notice tone="warn">This payee isn't verified by Kinpot. Only use an address they gave you themselves.</Notice>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <div className="text-[13px] font-medium">Who gets paid?</div>
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => setManual(true)}>
          Not listed?
        </button>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="School, hospital or landlord" className="pl-9" />
      </div>
      <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
        {results.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted">No payees found. Use “Not listed?” to add one by address.</div>
        ) : (
          results.map((p) => (
            <button
              key={p.address}
              type="button"
              onClick={() => onChange(p)}
              className="flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-0 hover:bg-sunk"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm">
                  {p.name}
                  {p.verified && <BadgeCheck className="size-4 text-accent" />}
                </div>
                <div className="text-xs text-muted">
                  {PAYEE_KINDS[p.kind as PayeeKind] ?? "Payee"} · {p.city}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
