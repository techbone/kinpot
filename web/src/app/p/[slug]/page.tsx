import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PotView } from "@/components/pot-view";
import { db, schema } from "@/lib/db";
import { networkForScope, networks } from "@/lib/networks";

export const dynamic = "force-dynamic";

async function lookup(slug: string) {
  const d = await db();
  const [row] = await d.select().from(schema.pots).where(eq(schema.pots.slug, slug));
  if (!row) return null;
  const key = networkForScope(row.scope);
  return key ? { row, network: networks[key] } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const found = await lookup((await params).slug);
  if (!found) return { title: "Kinpot" };
  const { bill } = found.row;
  return {
    title: `${bill.title} · Kinpot`,
    description: `Pays ${bill.payeeName} directly. Chip in your share. If the bill doesn't go ahead, everyone is refunded.`,
  };
}

export default async function SharedPotPage({ params }: { params: Promise<{ slug: string }> }) {
  const found = await lookup((await params).slug);
  if (!found) notFound();
  return <PotView network={found.network.key} potId={BigInt(found.row.potId)} />;
}
