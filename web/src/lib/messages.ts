import type { Address } from "viem";

/** Off-chain EIP-712 messages. Passkey accounts sign them silently; wallets show a prompt.
 *  They are never submitted onchain, so chainId only scopes them to a network. */
export function messageDomain(chainId: number) {
  return { name: "Kinpot", version: "1", chainId } as const;
}

export const profileTypes = {
  Profile: [
    { name: "account", type: "address" },
    { name: "name", type: "string" },
  ],
} as const;

export const shareClaimTypes = {
  ShareClaim: [
    { name: "account", type: "address" },
    { name: "potId", type: "uint256" },
    { name: "shareIndex", type: "uint256" },
  ],
} as const;

export const payeeTypes = {
  PayeeRegistration: [
    { name: "account", type: "address" },
    { name: "name", type: "string" },
    { name: "kind", type: "string" },
    { name: "city", type: "string" },
  ],
} as const;

export type PotMeta = {
  slug: string;
  bill: import("./bill").Bill;
  claims: { shareIndex: number; address: Address }[];
  names: Record<string, string>;
  payee?: { name: string; kind: string; city: string; verified: boolean };
};

export const PAYEE_KINDS = {
  school: "School",
  hospital: "Hospital",
  landlord: "Landlord",
  utility: "Utility",
  other: "Other",
} as const;
export type PayeeKind = keyof typeof PAYEE_KINDS;
