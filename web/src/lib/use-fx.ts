"use client";

import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";

import { AUSD_DECIMALS } from "./kinpot";

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

/** "≈ ₦638,880" for an AUSD amount, or null while the rate is unknown. */
export function useNaira() {
  const { data } = useQuery({
    queryKey: ["fx"],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => (await (await fetch("/api/fx")).json()) as { ngn: number | null },
  });
  return (amount: bigint | null | undefined): string | null => {
    if (!data?.ngn || amount === null || amount === undefined) return null;
    return `≈ ${naira.format(Number(formatUnits(amount, AUSD_DECIMALS)) * data.ngn)}`;
  };
}
