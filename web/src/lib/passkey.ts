"use client";

import { createPasskeyWithPrfOutput, createSecp256k1SigningSession, getPasskeyPrfOutput, isMeraError } from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import type { Address, LocalAccount } from "viem";

/** What we keep in localStorage. Never the key: that is re-derived from the passkey on demand. */
export type StoredPasskey = {
  credentialId: string;
  transports?: readonly string[];
  address: Address;
  name: string;
};

const STORAGE_KEY = "kinpot.passkey";

export function loadStoredPasskey(): StoredPasskey | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredPasskey) : null;
  } catch {
    return null;
  }
}

export function saveStoredPasskey(value: StoredPasskey | null) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // private mode: the account still works for this tab
  }
}

/** Mera's documented derivation: PRF output → BIP-39 entropy → seed → m/44'/60'/0'/0/0. */
function deriveAccount(prfOutput: Uint8Array): LocalAccount {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
  if (!node.privateKey) throw new Error("Could not derive an account from this passkey.");
  const session = createSecp256k1SigningSession({ privateKey: node.privateKey });
  node.wipePrivateData();
  return toViemAccount(session);
}

function rpId() {
  return window.location.hostname;
}

export async function createPasskeyAccount(name: string): Promise<{ stored: StoredPasskey; account: LocalAccount }> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: rpId(), name: "Kinpot" },
    user: { name, displayName: name },
  });
  const account = deriveAccount(created.prfOutput);
  const stored: StoredPasskey = {
    credentialId: created.credentialId,
    transports: created.transports,
    address: account.address,
    name,
  };
  return { stored, account };
}

/** Unlock with a known passkey, or let the platform offer any Kinpot passkey (new device). */
export async function unlockPasskeyAccount(known?: StoredPasskey | null): Promise<{ credentialId: string; account: LocalAccount }> {
  const result = await getPasskeyPrfOutput({
    rpId: rpId(),
    credential: known ? { credentialId: known.credentialId, transports: known.transports } : undefined,
  });
  return { credentialId: result.credentialId, account: deriveAccount(result.prfOutput) };
}

export function passkeyErrorMessage(error: unknown): string {
  if (isMeraError(error)) {
    switch (error.code) {
      case "PRF_UNAVAILABLE":
        return "This browser's passkey manager can't create a Kinpot account. Try Safari, iCloud Keychain, Google Password Manager or 1Password, or use a wallet instead.";
      case "PASSKEY_OPERATION_FAILED":
        return "The passkey prompt was closed or isn't available here.";
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : "Something went wrong with the passkey.";
}
