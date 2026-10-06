"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { signTypedData as wagmiSignTypedData, switchChain } from "wagmi/actions";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex, LocalAccount, TypedDataDefinition } from "viem";
import { WagmiProvider, useConnection, useConnect, useConnectors, useDisconnect } from "wagmi";

import { messageDomain, profileTypes } from "@/lib/messages";
import { defaultNetwork, isNetworkKey, networks, type Network, type NetworkKey } from "@/lib/networks";
import {
  createPasskeyAccount,
  loadStoredPasskey,
  saveStoredPasskey,
  unlockPasskeyAccount,
  type StoredPasskey,
} from "@/lib/passkey";
import { wagmiConfig } from "@/lib/wagmi";

// -------------------------------------------------------------------------------------------------
// Network
// -------------------------------------------------------------------------------------------------

type NetworkState = { network: Network; setNetwork: (key: NetworkKey) => void };
const NetworkContext = createContext<NetworkState | null>(null);
const NETWORK_KEY = "kinpot.network";

function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [key, setKey] = useState<NetworkKey>(defaultNetwork);

  useEffect(() => {
    // A shared link carries ?n=testnet|mainnet and wins over the remembered choice.
    const fromUrl = new URLSearchParams(window.location.search).get("n");
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(NETWORK_KEY);
    } catch {}
    const next = isNetworkKey(fromUrl) ? fromUrl : isNetworkKey(remembered) ? remembered : null;
    if (next && networks[next].deployment) setKey(next);
  }, []);

  const setNetwork = useCallback((next: NetworkKey) => {
    setKey(next);
    try {
      localStorage.setItem(NETWORK_KEY, next);
    } catch {}
  }, []);

  const value = useMemo(() => ({ network: networks[key], setNetwork }), [key, setNetwork]);
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkState {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork outside NetworkProvider");
  return ctx;
}

// -------------------------------------------------------------------------------------------------
// Account: a passkey (Mera) or an injected wallet, behind one signTypedData
// -------------------------------------------------------------------------------------------------

export type AccountKind = "passkey" | "wallet";

type AccountState = {
  mounted: boolean;
  address?: Address;
  kind?: AccountKind;
  name?: string;
  createPasskey: (name: string) => Promise<void>;
  signInWithPasskey: () => Promise<void>;
  connectWallet: () => Promise<void>;
  signOut: () => void;
  /** Signs and saves the display name the family sees. */
  setName: (name: string) => Promise<void>;
  /** Signs EIP-712 data for the current network. Unlocks the passkey (one prompt) if needed. */
  signTypedData: (data: TypedDataDefinition) => Promise<Hex>;
};

const AccountContext = createContext<AccountState | null>(null);

function AccountProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [passkey, setPasskey] = useState<StoredPasskey | null>(null);
  const signer = useRef<LocalAccount | null>(null);
  const wallet = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const { network } = useNetwork();
  const [remoteName, setRemoteName] = useState<string | null>(null);

  useEffect(() => {
    setPasskey(loadStoredPasskey());
    setMounted(true);
  }, []);

  const currentAddress = passkey?.address ?? (wallet.status === "connected" ? wallet.address : undefined);
  useEffect(() => {
    setRemoteName(null);
    if (!currentAddress) return;
    let cancelled = false;
    fetch(`/api/profile?address=${currentAddress}`)
      .then((r) => r.json())
      .then((j: { name: string | null }) => !cancelled && setRemoteName(j.name))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentAddress]);

  const saveProfile = useCallback(
    async (account: { address: Address; signTypedData: (d: TypedDataDefinition) => Promise<Hex> }, name: string) => {
      const chainId = network.chain.id;
      const signature = await account.signTypedData({
        domain: messageDomain(chainId),
        types: profileTypes,
        primaryType: "Profile",
        message: { account: account.address, name },
      } as TypedDataDefinition);
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ network: network.key, address: account.address, name, signature }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Couldn't save your name.");
      setRemoteName(name);
    },
    [network],
  );

  const createPasskey = useCallback(
    async (name: string) => {
      const { stored, account } = await createPasskeyAccount(name);
      signer.current = account;
      saveStoredPasskey(stored);
      setPasskey(stored);
      // Best effort: the account works without it, and the name can be set again later.
      saveProfile(account, name).catch(() => {});
    },
    [saveProfile],
  );

  const signInWithPasskey = useCallback(async () => {
    const { credentialId, account } = await unlockPasskeyAccount(null);
    const stored: StoredPasskey = { credentialId, address: account.address, name: "" };
    signer.current = account;
    saveStoredPasskey(stored);
    setPasskey(stored);
  }, []);

  const connectWallet = useCallback(async () => {
    const named = connectors.filter((c) => c.id !== "injected");
    const connector = (named.length > 0 ? named : connectors)[0];
    if (!connector) throw new Error("No browser wallet found. Install MetaMask or use a passkey.");
    await connect.mutateAsync({ connector });
  }, [connectors, connect]);

  const signOut = useCallback(() => {
    signer.current = null;
    saveStoredPasskey(null);
    setPasskey(null);
    if (wallet.status === "connected") disconnect.mutate();
  }, [wallet.status, disconnect]);

  const signTypedData = useCallback(
    async (data: TypedDataDefinition): Promise<Hex> => {
      if (passkey) {
        if (!signer.current) {
          const { account } = await unlockPasskeyAccount(passkey);
          if (account.address !== passkey.address) throw new Error("That passkey belongs to a different account.");
          signer.current = account;
        }
        return signer.current.signTypedData(data);
      }
      if (wallet.status !== "connected") throw new Error("Sign in first.");
      const chainId = Number(data.domain?.chainId);
      if (wallet.chainId !== chainId) await switchChain(wagmiConfig, { chainId: chainId as never });
      return wagmiSignTypedData(wagmiConfig, data as never);
    },
    [passkey, wallet.status, wallet.chainId],
  );

  const setName = useCallback(
    async (name: string) => {
      if (!currentAddress) throw new Error("Sign in first.");
      await saveProfile({ address: currentAddress, signTypedData }, name);
      if (passkey) {
        const next = { ...passkey, name };
        saveStoredPasskey(next);
        setPasskey(next);
      }
    },
    [currentAddress, saveProfile, signTypedData, passkey],
  );

  const value = useMemo<AccountState>(() => {
    const kind: AccountKind | undefined = passkey ? "passkey" : wallet.status === "connected" ? "wallet" : undefined;
    return {
      mounted,
      kind,
      address: currentAddress,
      name: passkey?.name || remoteName || undefined,
      createPasskey,
      signInWithPasskey,
      connectWallet,
      signOut,
      setName,
      signTypedData,
    };
  }, [mounted, passkey, currentAddress, remoteName, createPasskey, signInWithPasskey, connectWallet, signOut, setName, signTypedData]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountState {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount outside AccountProvider");
  return ctx;
}

// -------------------------------------------------------------------------------------------------

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <NetworkProvider>
          <AccountProvider>{children}</AccountProvider>
        </NetworkProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
