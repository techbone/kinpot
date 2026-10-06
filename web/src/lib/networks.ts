import { createPublicClient, defineChain, fallback, http, type Chain, type PublicClient } from "viem";
import { monad, monadTestnet } from "viem/chains";

import { deployments, type Deployment } from "./deployments";

export type NetworkKey = "testnet" | "mainnet" | "local";

export type Network = {
  key: NetworkKey;
  label: string;
  chain: Chain;
  rpc: string[];
  explorer: string;
  /** Undefined until the contracts are deployed on this chain. */
  deployment?: Deployment;
};

const anvil = defineChain({
  id: 31337,
  name: "Local",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

function rpcs(envUrl: string | undefined, chain: Chain): string[] {
  return [envUrl, ...chain.rpcUrls.default.http].filter((u): u is string => Boolean(u));
}

export const networks: Record<NetworkKey, Network> = {
  testnet: {
    key: "testnet",
    label: "Testnet",
    chain: monadTestnet,
    rpc: rpcs(process.env.NEXT_PUBLIC_RPC_TESTNET, monadTestnet),
    explorer: "https://testnet.monadexplorer.com",
    deployment: deployments[monadTestnet.id],
  },
  mainnet: {
    key: "mainnet",
    label: "Mainnet",
    chain: monad,
    rpc: rpcs(process.env.NEXT_PUBLIC_RPC_MAINNET, monad),
    explorer: "https://monadscan.com",
    deployment: deployments[monad.id],
  },
  local: {
    key: "local",
    label: "Local",
    chain: anvil,
    rpc: ["http://127.0.0.1:8545"],
    explorer: "",
    deployment: deployments[anvil.id],
  },
};

/** Networks offered in the switcher. Local only appears in development. */
export const visibleNetworks: Network[] = [
  networks.testnet,
  networks.mainnet,
  ...(process.env.NEXT_PUBLIC_ENABLE_LOCAL === "1" ? [networks.local] : []),
];

export const defaultNetwork: NetworkKey =
  process.env.NEXT_PUBLIC_ENABLE_LOCAL === "1" && !networks.testnet.deployment ? "local" : "testnet";

export function isNetworkKey(value: unknown): value is NetworkKey {
  return value === "testnet" || value === "mainnet" || value === "local";
}

const clients = new Map<NetworkKey, PublicClient>();

export function publicClient(key: NetworkKey): PublicClient {
  let client = clients.get(key);
  if (!client) {
    const net = networks[key];
    client = createPublicClient({
      chain: net.chain,
      transport: fallback(net.rpc.map((url) => http(url, { retryCount: 3, retryDelay: 300 }))),
    }) as PublicClient;
    clients.set(key, client);
  }
  return client;
}

export function explorerUrl(key: NetworkKey, kind: "tx" | "address", value: string): string | undefined {
  const base = networks[key].explorer;
  return base ? `${base}/${kind}/${value}` : undefined;
}
