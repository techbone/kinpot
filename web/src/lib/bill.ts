import { keccak256, stringToBytes, type Hex } from "viem";

export const CATEGORIES = {
  school: "School fees",
  hospital: "Hospital bill",
  rent: "Rent",
  other: "Other bill",
} as const;
export type Category = keyof typeof CATEGORIES;

export type Share = { name: string; amount: string };

/** Everything the family sees about a bill. Hashed onchain as `billHash`, so it can't be edited later. */
export type Bill = {
  v: 1;
  title: string;
  category: Category;
  payeeName: string;
  reference: string;
  note: string;
  /** Who is expected to cover what, in AUSD base units. */
  shares: Share[];
};

/** Fixed key order so the same bill always produces the same hash. */
export function canonicalBill(bill: Bill): string {
  return JSON.stringify({
    v: 1,
    title: bill.title.trim(),
    category: bill.category,
    payeeName: bill.payeeName.trim(),
    reference: bill.reference.trim(),
    note: bill.note.trim(),
    shares: bill.shares.map((s) => ({ name: s.name.trim(), amount: s.amount })),
  });
}

export function billHash(bill: Bill): Hex {
  return keccak256(stringToBytes(canonicalBill(bill)));
}

export function isBill(value: unknown): value is Bill {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  return (
    b.v === 1 &&
    typeof b.title === "string" &&
    b.title.length > 0 &&
    b.title.length <= 120 &&
    typeof b.category === "string" &&
    b.category in CATEGORIES &&
    typeof b.payeeName === "string" &&
    b.payeeName.length <= 120 &&
    typeof b.reference === "string" &&
    b.reference.length <= 200 &&
    typeof b.note === "string" &&
    b.note.length <= 1000 &&
    Array.isArray(b.shares) &&
    b.shares.length <= 32 &&
    b.shares.every(
      (s) =>
        s &&
        typeof s === "object" &&
        typeof (s as Share).name === "string" &&
        (s as Share).name.length <= 60 &&
        typeof (s as Share).amount === "string" &&
        /^\d+$/.test((s as Share).amount),
    )
  );
}
