"use client";

import { Fingerprint, KeyRound, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";

import { errorMessage } from "@/lib/hooks";
import { passkeyErrorMessage } from "@/lib/passkey";
import { useAccount } from "./providers";
import { Button, cx, Field, Input, Notice } from "./ui";

export function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const account = useAccount();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<null | "create" | "existing" | "wallet">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open && account.address) onClose();
  }, [open, account.address, onClose]);

  if (!open) return null;

  async function run(kind: "create" | "existing" | "wallet") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "create") await account.createPasskey(name.trim());
      else if (kind === "existing") await account.signInWithPasskey();
      else await account.connectWallet();
    } catch (e) {
      setError(kind === "wallet" ? errorMessage(e) : passkeyErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/30 sm:place-items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-labelledby="signin-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-2xl border border-line bg-card p-6 shadow-2xl sm:rounded-2xl"
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 id="signin-title" className="font-display text-xl font-semibold tracking-tight">
              Sign in to Kinpot
            </h2>
            <p className="mt-1 text-sm text-muted">Use Face ID, Touch ID or your phone's screen lock. No password, no app.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-sunk hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void run("create");
          }}
          className="space-y-3"
        >
          <Field label="Your name" hint="Your family sees this next to what you've paid.">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Kemi" maxLength={40} autoFocus />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={!name.trim() || busy !== null}>
            <Fingerprint className="size-4" />
            {busy === "create" ? "Waiting for your passkey…" : "Create account with a passkey"}
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-faint">
          <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => void run("existing")} disabled={busy !== null}>
            <KeyRound className="size-4" />
            {busy === "existing" ? "Waiting…" : "I have a passkey"}
          </Button>
          <Button variant="secondary" onClick={() => void run("wallet")} disabled={busy !== null}>
            <Wallet className="size-4" />
            {busy === "wallet" ? "Connecting…" : "Browser wallet"}
          </Button>
        </div>

        {error && (
          <div className="mt-4">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
      </div>
    </div>
  );
}

/** Renders children when signed in, otherwise a prompt that opens the sign-in dialog. */
export function SignInGate({ children, prompt, spaced = true }: { children: React.ReactNode; prompt: string; spaced?: boolean }) {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  if (!account.mounted) return null;
  if (account.address) return <>{children}</>;
  return (
    <>
      <Button size="lg" className={cx("w-full", spaced && "mt-4")} onClick={() => setOpen(true)}>
        {prompt}
      </Button>
      <SignInDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
