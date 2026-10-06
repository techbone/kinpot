import { notFound } from "next/navigation";

import { PotView } from "@/components/pot-view";
import { isNetworkKey } from "@/lib/networks";

export default async function PotPage({ params }: { params: Promise<{ network: string; id: string }> }) {
  const { network, id } = await params;
  if (!isNetworkKey(network) || !/^\d+$/.test(id)) notFound();
  return <PotView network={network} potId={BigInt(id)} />;
}
