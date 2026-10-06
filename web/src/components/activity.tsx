"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import type { Address } from "viem";

import { formatDateTime, formatUsd } from "@/lib/format";
import { fetchActivity, hasIndexer, type ActivityItem } from "@/lib/indexer";
import { explorerUrl, type NetworkKey } from "@/lib/networks";
import { Card, SectionTitle } from "./ui";

function describe(item: ActivityItem, name: (a: Address) => string, payeeName: string): string {
  const who = item.actor ? name(item.actor) : "Someone";
  const amount = item.amount ? formatUsd(BigInt(item.amount)) : "";
  switch (item.kind) {
    case "created":
      return `${who} started the pot for ${amount}`;
    case "contributed":
      return `${who} put in ${amount}`;
    case "confirmed":
      return `${payeeName} confirmed the bill`;
    case "declined":
      return `${payeeName} declined the bill`;
    case "cancelled":
      return `${who} called off the pot`;
    case "paid":
      return `${amount} paid to ${payeeName}`;
    case "closed":
      return "The pot closed";
    case "refunded":
      return `${amount} refunded to ${who}`;
    case "refund_failed":
      return `Refund of ${amount} to ${who} is waiting to be claimed`;
  }
}

/** Every onchain event for this pot, newest first, each with its receipt. Needs the Envio indexer. */
export function ActivityFeed({
  network,
  potId,
  nameOf,
  payeeName,
}: {
  network: NetworkKey;
  potId: bigint;
  nameOf: (a: Address) => string;
  payeeName: string;
}) {
  const enabled = hasIndexer(network);
  const query = useQuery({
    queryKey: ["activity", network, potId.toString()],
    enabled,
    refetchInterval: 5000,
    queryFn: () => fetchActivity(network, potId),
  });
  if (!enabled || !query.data?.length) return null;
  return (
    <section className="mt-8">
      <SectionTitle>Activity</SectionTitle>
      <Card className="divide-y divide-line">
        {query.data.map((item) => {
          const href = explorerUrl(network, "tx", item.txHash);
          return (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">{describe(item, nameOf, payeeName)}</span>
              <span className="shrink-0 text-xs text-muted">{formatDateTime(Number(item.timestamp))}</span>
              {href && (
                <a href={href} target="_blank" rel="noreferrer" className="shrink-0 text-faint hover:text-ink" aria-label="Receipt">
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          );
        })}
      </Card>
    </section>
  );
}

