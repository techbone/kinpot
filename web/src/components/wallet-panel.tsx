"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { erc20Abi } from "viem";

import { faucet } from "@/lib/actions";
import { formatUsd } from "@/lib/format";
import { rampUrl } from "@/lib/onramp";
import { errorMessage } from "@/lib/hooks";
import { publicClient } from "@/lib/networks";
import { useAccount, useNetwork } from "./providers";
import { Button } from "./ui";

export function useAusdBalance() {
  const { network } = useNetwork();
  const { address } = useAccount();
  return useQuery({
    queryKey: ["ausd-balance", network.key, address],
    enabled: Boolean(address && network.deployment),
    refetchInterval: 8000,
    queryFn: () =>
      publicClient(network.key).readContract({
        address: network.deployment!.ausd,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address!],
      }),
  });
}

/** Balance on the selected network, plus the testnet faucet. */
export function WalletPanel() {
  const { network } = useNetwork();
  const { address } = useAccount();
  const balance = useAusdBalance();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!network.deployment) {
    return <p className="text-xs text-muted">Kinpot isn't live on {network.label} yet.</p>;
  }

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted">Balance on {network.label}</span>
        <span className="num text-sm">{balance.data === undefined ? "—" : formatUsd(balance.data)}</span>
      </div>
      {network.deployment.mockAusd ? (
        <Button
          size="sm"
          variant="secondary"
          className="mt-3 w-full"
          disabled={busy || !address}
          onClick={async () => {
            setBusy(true);
            setMessage(null);
            try {
              await faucet(network.key, address!);
              await queryClient.invalidateQueries({ queryKey: ["ausd-balance"] });
              setMessage("Added $500.00 of test money.");
            } catch (e) {
              setMessage(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Adding…" : "Add $500 of test money"}
        </Button>
      ) : (
        <>
          <a href={rampUrl(address!)} target="_blank" rel="noreferrer" className="mt-3 block">
            <Button size="sm" variant="secondary" className="w-full">
              Add money with a card or bank
            </Button>
          </a>
          <p className="mt-2 text-xs leading-relaxed text-muted">Or send AUSD on Monad to your address above.</p>
        </>
      )}
      {message && <p className="mt-2 text-xs text-muted">{message}</p>}
    </div>
  );
}
