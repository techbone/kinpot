import { formatDate } from "@/lib/format";
import type { Phase, Pot } from "@/lib/kinpot";
import { Pill, type Tone } from "./ui";

const LABEL: Record<Phase, [string, Tone]> = {
  collecting: ["Collecting", "accent"],
  "awaiting-payee": ["Waiting for payee", "warn"],
  scheduled: ["Scheduled", "accent"],
  ready: ["Ready to pay", "ok"],
  paid: ["Paid", "ok"],
  refunding: ["Refunding", "warn"],
  refunded: ["Refunded", "neutral"],
};

export function PhasePill({ phase, pot }: { phase: Phase; pot: Pot }) {
  const [label, tone] = LABEL[phase];
  return (
    <Pill tone={tone}>
      <span className="size-1.5 rounded-full bg-current" />
      {phase === "scheduled" ? `Pays ${formatDate(pot.dueAt)}` : label}
    </Pill>
  );
}
