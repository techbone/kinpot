"use client";

import { BadgeCheck, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PotList, usePotList } from "@/components/pot-list";
import { useAccount, useNetwork } from "@/components/providers";
import { SignInDialog } from "@/components/sign-in";
import { Button, Card, Pill, Progress, SectionTitle } from "@/components/ui";

export default function Home() {
  const account = useAccount();
  return account.mounted && account.address ? <Dashboard /> : <Landing />;
}

function Dashboard() {
  const account = useAccount();
  const { network } = useNetwork();
  const list = usePotList(network.key, account.address);
  const items = list.data ?? [];
  const asPayee = items.filter((x) => x.pot.payee === account.address);
  const mine = items.filter((x) => x.pot.payee !== account.address);

  return (
    <div className="pt-10 sm:pt-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">
            {account.name ? `Hi ${account.name}` : "Your pots"}
          </h1>
          <p className="mt-1 text-[15px] text-muted">Bills you're paying into on {network.label}.</p>
        </div>
        <Link href="/new">
          <Button>Start a pot</Button>
        </Link>
      </div>

      {!network.deployment ? (
        <Card className="mt-8 p-6 text-sm text-muted">Kinpot isn't live on {network.label} yet. Switch to Testnet above.</Card>
      ) : (
        <div className="mt-8 space-y-10">
          {asPayee.length > 0 && (
            <section>
              <SectionTitle>Bills addressed to you</SectionTitle>
              <PotList items={asPayee} loading={false} empty={null} />
            </section>
          )}
          <section>
            <SectionTitle>Your family's bills</SectionTitle>
            <PotList
              items={mine}
              loading={list.isLoading}
              empty={
                <Card className="px-6 py-10 text-center">
                  <p className="text-[15px] font-medium">No pots yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
                    Start one for the next school fees, hospital bill or rent. When someone sends you a pot link, it shows up here after you pay in.
                  </p>
                  <Link href="/new" className="mt-5 inline-block">
                    <Button variant="secondary">Start a pot</Button>
                  </Link>
                </Card>
              }
            />
          </section>
        </div>
      )}
    </div>
  );
}

function Landing() {
  const [signIn, setSignIn] = useState(false);
  return (
    <div className="pt-12 sm:pt-20">
      <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="text-[13px] font-medium text-accent">For families sending money home</p>
          <h1 className="mt-3 font-display text-[40px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[52px]">
            Pay the bill,
            <br />
            not the person.
          </h1>
          <p className="mt-5 max-w-md text-[17px] leading-relaxed text-muted">
            Brothers and sisters abroad put money into one pot for Mummy's hospital bill, the school fees or the rent. It goes straight to the hospital, school or
            landlord, and only when the bill is covered, confirmed and due.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Button size="lg" onClick={() => setSignIn(true)}>
              Start a pot
            </Button>
            <a href="#how" className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
              How it works
            </a>
          </div>
        </div>
        <ExamplePot />
      </div>

      <section id="how" className="mt-24 scroll-mt-20">
        <h2 className="font-display text-xl font-semibold tracking-tight">How it works</h2>
        <ol className="mt-6 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          {[
            ["Start a pot for one bill", "Pick the school, hospital or landlord, the amount and the due date. Share the link in the family WhatsApp group."],
            ["Everyone pays their part", "From London, Toronto or Lagos, with Face ID. The money waits in the pot, where nobody can spend it."],
            ["The payee gets paid", "Once it's covered, the payee has confirmed the bill and the date arrives. If not, everyone is refunded automatically."],
          ].map(([title, body], i) => (
            <li key={title} className="bg-card p-6">
              <span className="num text-xs text-faint">0{i + 1}</span>
              <h3 className="mt-3 text-[15px] font-medium">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16 grid gap-8 border-t border-line pt-10 sm:grid-cols-3">
        {[
          ["Money moves to two places only", "The payee you chose, or back to whoever paid. There is no third option, for anyone, including us."],
          ["The payee confirms first", "The school or hospital confirms the bill is real before a kobo moves. No more fake fee notices."],
          ["Everyone sees everything", "Who has paid, how much is left and where it went, with a receipt for every payment."],
        ].map(([title, body]) => (
          <div key={title}>
            <h3 className="text-sm font-medium">{title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
          </div>
        ))}
      </section>
      <SignInDialog open={signIn} onClose={() => setSignIn(false)} />
    </div>
  );
}

function ExamplePot() {
  const people = [
    ["Tobi", "London", "$200.00"],
    ["Kemi", "Toronto", "$150.00"],
    ["Femi", "Lagos", "$130.00"],
  ];
  return (
    <Card className="relative p-5 shadow-xl shadow-black/[0.04] sm:p-6">
      <div className="flex items-center justify-between text-[12px] text-muted">
        <span>School fees</span>
        <span className="text-faint">Example</span>
      </div>
      <div className="mt-2 font-display text-lg font-semibold tracking-tight">Dayo's school fees, 2nd term</div>
      <div className="mt-1 flex items-center gap-1.5 text-[13px] text-muted">
        Pays <span className="text-ink">Grace Model College</span>
        <BadgeCheck className="size-4 text-accent" />
        <span>· Ibadan</span>
      </div>
      <div className="mt-5 flex items-end justify-between">
        <div className="num text-3xl font-medium">$480.00</div>
        <Pill tone="accent">
          <span className="size-1.5 rounded-full bg-current" /> Pays 15 Nov
        </Pill>
      </div>
      <div className="mt-3">
        <Progress value={480n} max={480n} />
      </div>
      <ul className="mt-5 divide-y divide-line border-t border-line">
        {people.map(([name, city, amount]) => (
          <li key={name} className="flex items-center gap-3 py-2.5">
            <span className="grid size-7 place-items-center rounded-full bg-ok-soft text-[11px] font-semibold text-ok">{name[0]}</span>
            <span className="flex-1 text-sm">
              {name} <span className="text-muted">· {city}</span>
            </span>
            <span className="num text-sm">{amount}</span>
            <Check className="size-4 text-ok" />
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-sunk px-3 py-2 text-[12px] text-muted">
        <Check className="size-3.5 text-ok" /> Grace Model College confirmed invoice INV-2291
      </div>
    </Card>
  );
}
