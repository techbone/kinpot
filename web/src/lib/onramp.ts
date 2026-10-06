import type { Address } from "viem";

/** Ramp Network sells AUSD on Monad (asset MONAD_AUSD, checked against Ramp's asset API on 2026-10-06)
 *  by card, bank transfer and Apple/Google Pay in the UK, US and most countries outside the EU. */
export function rampUrl(address: Address, amountUsd?: number): string {
  const params = new URLSearchParams({
    hostAppName: "Kinpot",
    swapAsset: "MONAD_AUSD",
    defaultFlow: "ONRAMP",
    userAddress: address,
  });
  if (amountUsd) params.set("fiatValue", Math.ceil(amountUsd).toString());
  if (amountUsd) params.set("fiatCurrency", "USD");
  if (process.env.NEXT_PUBLIC_RAMP_API_KEY) params.set("hostApiKey", process.env.NEXT_PUBLIC_RAMP_API_KEY);
  return `https://app.ramp.network/?${params}`;
}
