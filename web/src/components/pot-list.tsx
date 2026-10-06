"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Address } from "viem";

import { CATEGORIES, type Category } from "@/lib/bill";
import { fetchContributedPotIds, hasIndexer } from "@/lib/indexer";
import { formatUsd } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { phaseOf, readPot, type Pot } from "@/lib/kinpot";
import type { NetworkKey } from "@/lib/networks";
import { PhasePill } from "./phase";
import { Card, Progress, Skeleton } from "./ui";

export type PotSummary = {
  potId: string;
  slug: string;
  title: string;
  category: Category;
  payeeName: string;
  organizer: Address;
  payee: Address;
};

export function usePotList(network: NetworkKey, address: Address | undefined) {
  return useQuery({
    queryKey: ["pot-list", network, address],
    enabled: Boolean(address),
    refetchInterval: 10_000,
    queryFn: async () => {
      const res = await fetch(`/api/pots?network=${network}&address=${address}`);
      let { pots } = (await res.json()) as { pots: PotSummary[] };
      // The indexer also knows pots you paid into without picking a named share.
      if (hasIndexer(network)) {
        const ids = (await fetchContributedPotIds(network, address!).catch(() => [])).filter(
          (id) => !pots.some((p) => p.potId === id),
        );
        if (ids.length) {
          const more = (await (await fetch(`/api/pots?network=${network}&ids=${ids.join(",")}`)).json()) as { pots: PotSummary[] };
          pots = [...pots, ...more.pots];
        }
      }
      const onchain = await Promise.all(pots.map((p) => readPot(network, BigInt(p.potId))));
      return pots
        .map((summary, i) => ({ summary, pot: onchain[i] }))
        .filter((x): x is { summary: PotSummary; pot: Pot } => x.pot !== null)
        .sort((a, b) => Number(b.pot.id - a.pot.id));
    },
  });
}

export function PotList({
  items,
  loading,
  empty,
}: {
  items: { summary: PotSummary; pot: Pot }[] | undefined;
  loading: boolean;
  empty: React.ReactNode;
}) {
  const now = useNow();
  if (loading) {
    return (
      <Card className="divide-y divide-line">
        {[0, 1].map((i) => (
          <div key={i} className="p-4">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="mt-3 h-1.5 w-full" />
          </div>
        ))}
      </Card>
    );
  }
  if (!items || items.length === 0) return <>{empty}</>;
  return (
    <Card className="divide-y divide-line overflow-hidden">
      {items.map(({ summary, pot }) => {
        const phase = phaseOf(pot, now);
        return (
          <Link key={summary.potId} href={`/p/${summary.slug}`} className="group flex items-center gap-4 px-4 py-4 hover:bg-sunk/60 sm:px-5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="truncate text-[15px] font-medium">{summary.title}</span>
                <PhasePill phase={phase} pot={pot} />
              </div>
              <div className="mt-1 truncate text-[13px] text-muted">
                {CATEGORIES[summary.category]} · pays {summary.payeeName}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="max-w-xs flex-1">
                  <Progress value={pot.raised} max={pot.target} tone={phase === "paid" ? "ok" : "accent"} />
                </div>
                <span className="num text-xs text-muted">
                  {formatUsd(pot.raised)} / {formatUsd(pot.target)}
                </span>
              </div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-faint group-hover:text-muted" />
          </Link>
        );
      })}
    </Card>
  );
}
