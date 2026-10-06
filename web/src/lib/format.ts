import { formatUnits, parseUnits } from "viem";

import { AUSD_DECIMALS } from "./kinpot";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export function formatUsd(amount: bigint): string {
  return usd.format(Number(formatUnits(amount, AUSD_DECIMALS)));
}

/** "480", "480.5" → base units. Returns null for anything that isn't a positive amount. */
export function parseUsd(input: string): bigint | null {
  const clean = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,6})?$/.test(clean)) return null;
  const value = parseUnits(clean, AUSD_DECIMALS);
  return value > 0n ? value : null;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(unix: number): string {
  return dateFmt.format(new Date(unix * 1000));
}

export function formatDateTime(unix: number): string {
  return dateTimeFmt.format(new Date(unix * 1000));
}

/** "in 3 days", "in 4 min", "2 h ago". */
export function relativeTime(unix: number, now: number): string {
  const diff = unix - now;
  const abs = Math.abs(diff);
  const unit =
    abs < 60 ? `${abs} s` : abs < 3600 ? `${Math.round(abs / 60)} min` : abs < 86400 ? `${Math.round(abs / 3600)} h` : `${Math.round(abs / 86400)} days`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

/** A date, with the time when it's close enough for the time to matter. */
export function formatDue(unix: number, now: number): string {
  return Math.abs(unix - now) < 2 * 86400 ? formatDateTime(unix) : formatDate(unix);
}
