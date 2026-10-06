import { indexer, type EvmOnEventContext } from "envio";

const key = (chainId: number, potId: bigint) => `${chainId}-${potId}`;

type Ctx = EvmOnEventContext;
type Ev = { chainId: number; logIndex: number; block: { timestamp: number }; transaction: { hash: string } };

function activity(context: Ctx, event: Ev, potId: bigint, kind: string, actor?: string, amount?: bigint) {
  context.Activity.set({
    id: `${event.chainId}-${event.transaction.hash}-${event.logIndex}`,
    pot_id: key(event.chainId, potId),
    kind,
    actor,
    amount,
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });
}

indexer.onEvent({ contract: "Kinpot", event: "PotCreated" }, async ({ event, context }) => {
  const { potId, organizer, payee, target, dueAt, expiresAt, billHash } = event.params;
  context.Pot.set({
    id: key(event.chainId, potId),
    chainId: event.chainId,
    potId,
    organizer,
    payee,
    target,
    raised: 0n,
    dueAt,
    expiresAt,
    status: "Open",
    payeeConfirmed: false,
    refunded: false,
    billHash,
    contributorCount: 0,
    createdAt: BigInt(event.block.timestamp),
    createdTx: event.transaction.hash,
    paidAt: undefined,
    paidTx: undefined,
  });
  activity(context, event, potId, "created", organizer, target);
});

indexer.onEvent({ contract: "Kinpot", event: "Contributed" }, async ({ event, context }) => {
  const { potId, contributor, amount, raised } = event.params;
  const id = key(event.chainId, potId);
  const pot = await context.Pot.get(id);
  const participantId = `${id}-${contributor.toLowerCase()}`;
  const participant = await context.Participant.get(participantId);
  context.Participant.set({
    id: participantId,
    pot_id: id,
    address: contributor,
    contributed: (participant?.contributed ?? 0n) + amount,
    refunded: participant?.refunded ?? 0n,
  });
  if (pot) context.Pot.set({ ...pot, raised, contributorCount: pot.contributorCount + (participant ? 0 : 1) });
  activity(context, event, potId, "contributed", contributor, amount);
});

indexer.onEvent({ contract: "Kinpot", event: "BillConfirmed" }, async ({ event, context }) => {
  const pot = await context.Pot.get(key(event.chainId, event.params.potId));
  if (pot) context.Pot.set({ ...pot, payeeConfirmed: true });
  activity(context, event, event.params.potId, "confirmed", event.params.payee);
});

indexer.onEvent({ contract: "Kinpot", event: "BillDeclined" }, async ({ event, context }) => {
  activity(context, event, event.params.potId, "declined", event.params.payee);
});

indexer.onEvent({ contract: "Kinpot", event: "PotCancelled" }, async ({ event, context }) => {
  activity(context, event, event.params.potId, "cancelled", event.params.organizer);
});

indexer.onEvent({ contract: "Kinpot", event: "PotClosed" }, async ({ event, context }) => {
  const pot = await context.Pot.get(key(event.chainId, event.params.potId));
  if (pot) context.Pot.set({ ...pot, status: "Closed" });
  activity(context, event, event.params.potId, "closed");
});

indexer.onEvent({ contract: "Kinpot", event: "PotPaid" }, async ({ event, context }) => {
  const pot = await context.Pot.get(key(event.chainId, event.params.potId));
  if (pot) {
    context.Pot.set({ ...pot, status: "Paid", paidAt: BigInt(event.block.timestamp), paidTx: event.transaction.hash });
  }
  activity(context, event, event.params.potId, "paid", event.params.payee, event.params.amount);
});

async function onRefund(context: Ctx, event: Ev, potId: bigint, contributor: string, amount: bigint, kind: string) {
  const id = key(event.chainId, potId);
  const pot = await context.Pot.get(id);
  if (pot && !pot.refunded) context.Pot.set({ ...pot, refunded: true, status: "Closed" });
  if (kind === "refunded") {
    const participantId = `${id}-${contributor.toLowerCase()}`;
    const participant = await context.Participant.get(participantId);
    if (participant) context.Participant.set({ ...participant, refunded: participant.refunded + amount });
  }
  activity(context, event, potId, kind, contributor, amount);
}

indexer.onEvent({ contract: "Kinpot", event: "Refunded" }, async ({ event, context }) => {
  await onRefund(context, event, event.params.potId, event.params.contributor, event.params.amount, "refunded");
});

indexer.onEvent({ contract: "Kinpot", event: "RefundFailed" }, async ({ event, context }) => {
  await onRefund(context, event, event.params.potId, event.params.contributor, event.params.amount, "refund_failed");
});
