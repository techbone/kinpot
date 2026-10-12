"use client";

import { ChevronDown, LogOut, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { shortAddress } from "@/lib/format";
import { visibleNetworks } from "@/lib/networks";
import { Logo } from "./logo";
import { useAccount, useNetwork } from "./providers";
import { SignInDialog } from "./sign-in";
import { Button, CopyButton, cx } from "./ui";
import { WalletPanel } from "./wallet-panel";

function NetworkSwitch() {
  const { network, setNetwork } = useNetwork();
  return (
    <div className="inline-flex rounded-lg border border-line bg-card p-0.5 text-xs" role="tablist" aria-label="Network">
      {visibleNetworks.map((n) => {
        const active = n.key === network.key;
        const live = Boolean(n.deployment);
        return (
          <button
            key={n.key}
            role="tab"
            aria-selected={active}
            type="button"
            disabled={!live}
            title={live ? undefined : `Not deployed on ${n.label} yet`}
            onClick={() => setNetwork(n.key)}
            className={cx(
              "rounded-md px-2.5 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              active ? "bg-ink text-paper" : "text-muted hover:text-ink",
            )}
          >
            {n.label}
          </button>
        );
      })}
    </div>
  );
}

function AccountMenu() {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!account.address) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-lg border border-line bg-card pr-2 pl-2.5 text-sm hover:bg-sunk"
      >
        <span className="grid size-5 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent uppercase">
          {(account.name ?? "·").slice(0, 1)}
        </span>
        <span className="hidden max-w-28 truncate sm:inline">{account.name ?? shortAddress(account.address)}</span>
        <ChevronDown className="size-3.5 text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-line bg-card p-4 shadow-xl shadow-black/5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">{account.name ?? "Your account"}</div>
              <div className="text-xs text-muted">{account.kind === "passkey" ? "Signed in with a passkey" : "Browser wallet"}</div>
            </div>
          </div>
          <div className="mb-3 flex items-center justify-between rounded-lg bg-sunk px-3 py-2">
            <span className="num text-xs">{shortAddress(account.address)}</span>
            <CopyButton value={account.address} label="Copy address" />
          </div>
          <WalletPanel />
          <button
            type="button"
            onClick={() => {
              account.signOut();
              setOpen(false);
            }}
            className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted hover:bg-sunk hover:text-ink"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Header() {
  const account = useAccount();
  const pathname = usePathname();
  const [signIn, setSignIn] = useState(false);

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
        <Logo />
        <nav className="ml-4 hidden items-center gap-1 text-sm md:flex">
          {[
            ["/", "Pots"],
            ["/payee", "For payees"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={cx("rounded-md px-2.5 py-1.5", pathname === href ? "text-ink" : "text-muted hover:text-ink")}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <NetworkSwitch />
          {account.mounted && account.address ? (
            <>
              <Link href="/new" className="hidden sm:block">
                <Button size="sm">
                  <Plus className="size-4" /> New pot
                </Button>
              </Link>
              <AccountMenu />
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setSignIn(true)} disabled={!account.mounted}>
              Sign in
            </Button>
          )}
        </div>
      </div>
      <SignInDialog open={signIn} onClose={() => setSignIn(false)} />
    </header>
  );
}
