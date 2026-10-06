"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Clock } from "lucide-react";
import { useState } from "react";
import type { TypedDataDefinition } from "viem";

import { PotList, usePotList } from "@/components/pot-list";
import { useAccount, useNetwork } from "@/components/providers";
import { SignInGate } from "@/components/sign-in";
import { Button, Card, CopyButton, Field, Input, Notice, SectionTitle, Select } from "@/components/ui";
import { errorMessage } from "@/lib/hooks";
import { messageDomain, PAYEE_KINDS, payeeTypes, type PayeeKind } from "@/lib/messages";

type PayeeRow = { address: string; name: string; kind: string; city: string; verified: boolean };

export default function PayeePage() {
  const account = useAccount();
  return (
    <div className="mx-auto max-w-3xl pt-10 sm:pt-14">
      <p className="text-[13px] font-medium text-accent">For schools, hospitals and landlords</p>
      <h1 className="mt-2 font-display text-[28px] font-semibold tracking-[-0.02em]">Get paid by families abroad</h1>
      <p className="mt-2 max-w-xl text-[15px] text-muted">
        Families pool money for your bill and it comes to you directly, not through a relative. You confirm each bill first, so nobody can collect money in
        your name with a fake invoice.
      </p>
      <div className="mt-8">
        {account.mounted && account.address ? (
          <PayeeHome />
        ) : (
          <Card className="max-w-sm p-5">
            <SignInGate prompt="Sign in to receive payments">{null}</SignInGate>
          </Card>
        )}
      </div>
    </div>
  );
}

function PayeeHome() {
  const account = useAccount();
  const { network } = useNetwork();
  const profile = useQuery({
    queryKey: ["payee", account.address],
    queryFn: async () => ((await (await fetch(`/api/payees?address=${account.address}`)).json()) as { payee: PayeeRow | null }).payee,
  });
  const list = usePotList(network.key, account.address);
  const bills = (list.data ?? []).filter((x) => x.pot.payee === account.address);

  if (profile.isLoading) return null;
  if (!profile.data) return <Register />;

  return (
    <div className="space-y-10">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[15px] font-medium">
              {profile.data.name}
              {profile.data.verified && <BadgeCheck className="size-4 text-accent" />}
            </div>
            <div className="text-[13px] text-muted">
              {PAYEE_KINDS[profile.data.kind as PayeeKind]} · {profile.data.city}
            </div>
          </div>
          {profile.data.verified ? (
            <span className="inline-flex items-center gap-1 text-xs text-accent">
              <BadgeCheck className="size-3.5" /> Verified by Kinpot
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-warn">
              <Clock className="size-3.5" /> Verification pending
            </span>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-sunk px-3 py-2">
          <div className="min-w-0">
            <div className="text-[11px] text-muted">Your payment address</div>
            <div className="num truncate text-xs">{account.address}</div>
          </div>
          <CopyButton value={account.address!} />
        </div>
        <p className="mt-3 text-xs text-muted">
          Families find you by name when they start a pot. If they ask, give them this address. Never use one somebody else sends you.
        </p>
      </Card>

      <section>
        <SectionTitle>Bills addressed to you</SectionTitle>
        <PotList
          items={bills}
          loading={list.isLoading}
          empty={<Card className="px-6 py-10 text-center text-sm text-muted">No bills yet. When a family starts a pot for you, it appears here for you to confirm.</Card>}
        />
      </section>
    </div>
  );
}

function Register() {
  const account = useAccount();
  const { network } = useNetwork();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PayeeKind>("school");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const message = { account: account.address!, name: name.trim(), kind, city: city.trim() };
      const signature = await account.signTypedData({
        domain: messageDomain(network.chain.id),
        types: payeeTypes,
        primaryType: "PayeeRegistration",
        message,
      } as TypedDataDefinition);
      const res = await fetch("/api/payees", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ network: network.key, address: account.address, name: message.name, kind, city: message.city, signature }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Couldn't register.");
      await queryClient.invalidateQueries({ queryKey: ["payee"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-lg space-y-4 p-5 sm:p-6">
      <div className="text-[15px] font-medium">List yourself as a payee</div>
      <Field label="Name families will search for">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Grace Model College Bursary" maxLength={80} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as PayeeKind)}>
            {Object.entries(PAYEE_KINDS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="City">
          <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ibadan" maxLength={40} />
        </Field>
      </div>
      <Notice>Kinpot checks every payee before showing the verified badge. Until then, families see you as unverified.</Notice>
      <Button size="lg" className="w-full" disabled={busy || !name.trim() || !city.trim()} onClick={() => void submit()}>
        {busy ? "Saving…" : "List me as a payee"}
      </Button>
      {error && <Notice tone="danger">{error}</Notice>}
    </Card>
  );
}
