"use client";

import { useQuery } from "@tanstack/react-query";

import { billHash } from "./bill";
import { readContributions, readPot } from "./kinpot";
import type { PotMeta } from "./messages";
import type { NetworkKey } from "./networks";

export function usePot(network: NetworkKey, potId: bigint) {
  return useQuery({
    queryKey: ["pot", network, potId.toString()],
    refetchInterval: 4000,
    queryFn: async () => {
      const [pot, contributions, metaRes] = await Promise.all([
        readPot(network, potId),
        readContributions(network, potId),
        fetch(`/api/pots?network=${network}&potId=${potId}`).then((r) => r.json() as Promise<{ meta: PotMeta | null }>),
      ]);
      const meta = metaRes.meta;
      return {
        pot,
        contributions,
        meta,
        /** The stored details hash to the onchain billHash. */
        verified: Boolean(pot && meta && billHash(meta.bill) === pot.billHash),
      };
    },
  });
}

export type PotData = NonNullable<ReturnType<typeof usePot>["data"]>;
