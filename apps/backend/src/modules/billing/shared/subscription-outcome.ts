import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BillingPrisma } from "../../../infrastructure/prisma/index.js";
import { lockSubscription } from "../infrastructure/postgres/catalog-lock.js";
import { priceSnapshotSchema, type PriceSnapshot } from "../domain/pricing.js";
import { subscriptionPeriodEnd } from "../domain/subscription-period.js";
import { attemptKindSchema, subscriptionConsentSchema, type AttemptKind } from "../domain/subscription-change.js";

const acceptanceSchema = z.object({
  command: z.object({ consentEvidenceRefs: z.array(z.uuid()) }),
  evidence: z.array(z.object({ acceptedAt: z.iso.datetime(),
    document: z.object({ kind: z.string(), documentId: z.string(), version: z.string(), digest: z.string() }) })).min(1),
});

export interface AttemptRow {
  readonly id: string; readonly accountId: string; readonly kind: string;
  readonly subscriptionRef: string | null; readonly amountKopecks: bigint;
  readonly snapshot: unknown; readonly acceptance: unknown; readonly bindingCiphertext: string | null;
}
export interface PaidPeriod {
  readonly subscriptionRef: string; readonly startsAt: Date; readonly endsAt: Date; readonly snapshot: PriceSnapshot;
}

type TransitionPayload = { readonly [key: string]: string | number | boolean | null };

async function recordTransition(tx: BillingPrisma, subscriptionRef: string, kind: string, revision: number, payload: TransitionPayload, now: Date): Promise<void> {
  await tx.billingSubscriptionEvent.create({ data: { id: randomUUID(), subscriptionRef, kind, revision, payload, occurredAt: now, recordedAt: now } });
}

/**
 * Единственный переход подписки по подтверждённому банком платежу. Первая оплата задаёт
 * календарный anchor, своевременное продление считается от прежнего конца, повышение
 * сохраняет действующий срок.
 */
export async function settleConfirmedAttempt(tx: BillingPrisma, attempt: AttemptRow, paidAt: Date): Promise<PaidPeriod> {
  const kind: AttemptKind = attemptKindSchema.parse(attempt.kind);
  const snapshot = priceSnapshotSchema.parse(attempt.snapshot);
  if (kind === "initial") {
    const subscriptionRef = randomUUID();
    const endsAt = subscriptionPeriodEnd(paidAt, snapshot.paymentOption.months);
    const acceptance = subscriptionConsentSchema.parse(consentOf(attempt.acceptance, paidAt));
    await tx.billingSubscription.create({ data: {
      id: subscriptionRef, accountId: attempt.accountId, state: "active", revision: 1,
      snapshot: subscriptionSnapshot(snapshot), consent: acceptance,
      anchorAt: paidAt, anchorMonths: snapshot.paymentOption.months, periodIndex: 1,
      periodStartsAt: paidAt, paidUntil: endsAt, periodAmountKopecks: attempt.amountKopecks,
      // Привязка запечатана на идентификатор своей операции: он же публичный methodRef.
      ...(attempt.bindingCiphertext ? { bindingRef: attempt.id, bindingCiphertext: attempt.bindingCiphertext } : {}),
      createdAt: paidAt, updatedAt: paidAt,
    } });
    await tx.billingPurchase.update({ where: { id: attempt.id }, data: { subscriptionRef, periodIndex: 1 } });
    await recordTransition(tx, subscriptionRef, "subscription_started", 1, { attemptRef: attempt.id, paidUntil: endsAt.toISOString() }, paidAt);
    return { subscriptionRef, startsAt: paidAt, endsAt, snapshot };
  }
  const subscriptionRef = attempt.subscriptionRef;
  if (!subscriptionRef) throw new Error("Scheduled attempt without a subscription");
  const current = await tx.billingSubscription.findUniqueOrThrow({ where: { id: subscriptionRef } });
  const revision = current.revision + 1;
  if (kind === "renewal") {
    const anchorMonths = current.anchorMonths + snapshot.paymentOption.months;
    const startsAt = current.paidUntil;
    const endsAt = subscriptionPeriodEnd(current.anchorAt, anchorMonths);
    await tx.billingSubscription.update({ where: { id: subscriptionRef }, data: {
      revision, anchorMonths, periodIndex: current.periodIndex + 1, periodStartsAt: startsAt, paidUntil: endsAt,
      periodAmountKopecks: attempt.amountKopecks, snapshot: subscriptionSnapshot(snapshot), pendingChange: {}, updatedAt: paidAt,
    } });
    await recordTransition(tx, subscriptionRef, "period_renewed", revision, { attemptRef: attempt.id, paidUntil: endsAt.toISOString() }, paidAt);
    return { subscriptionRef, startsAt, endsAt, snapshot };
  }
  // Повышение оплачивает разницу за остаток срока: конец периода и его anchor не меняются.
  await tx.billingSubscription.update({ where: { id: subscriptionRef }, data: {
    revision, snapshot: subscriptionSnapshot(snapshot), periodAmountKopecks: BigInt(snapshot.paymentOption.priceKopecks), updatedAt: paidAt,
  } });
  await recordTransition(tx, subscriptionRef, "option_upgraded", revision, { attemptRef: attempt.id, paymentOptionId: snapshot.paymentOption.id }, paidAt);
  return { subscriptionRef, startsAt: paidAt, endsAt: current.paidUntil, snapshot };
}

/** Завершение расписания: оплаченный срок сохраняется, а место для новой покупки освобождается. */
export async function endSubscription(tx: BillingPrisma, subscriptionRef: string, reason: string, now: Date): Promise<void> {
  const current = await tx.billingSubscription.findUnique({ where: { id: subscriptionRef } });
  if (!current || current.state === "ended") return;
  const revision = current.revision + 1;
  await tx.billingSubscription.update({ where: { id: subscriptionRef }, data: { state: "ended", revision, pendingChange: {}, updatedAt: now } });
  await tx.billingPurchase.updateMany({ where: { subscriptionRef, kind: "initial", lifecycleActive: true }, data: { lifecycleActive: false } });
  await recordTransition(tx, subscriptionRef, "subscription_ended", revision, { reason }, now);
}

/**
 * Освобождает Account для новой покупки, когда оплаченный срок закончился и продлить его
 * нечем. Незавершённая попытка оплаты сохраняет подписку до сверки.
 */
export async function endLapsedSubscriptions(tx: BillingPrisma, accountId: string, now: Date): Promise<void> {
  const candidates = await tx.billingSubscription.findMany({ where: { accountId, state: { not: "ended" }, paidUntil: { lte: now } } });
  for (const candidate of candidates) {
    await lockSubscription(tx, candidate.id);
    const row = await tx.billingSubscription.findUniqueOrThrow({ where: { id: candidate.id } });
    if (row.state === "ended" || row.paidUntil > now) continue;
    if (await tx.billingPurchase.count({ where: { subscriptionRef: row.id, state: { in: inFlightStates } } })) continue;
    if (row.state === "active" && row.bindingCiphertext !== null && row.bindingRevokedAt === null) continue;
    await endSubscription(tx, row.id, row.state === "canceled" ? "canceled_period_ended" : "no_usable_payment_method", now);
  }
}

export const inFlightStates = ["prepared", "sent", "unknown", "pending", "authorized"];

function subscriptionSnapshot(snapshot: PriceSnapshot) {
  const { offer, paymentOption, currency, timezone, renewalPriceKopecks } = snapshot;
  return { offer, paymentOption, currency, timezone, renewalPriceKopecks };
}

function consentOf(acceptance: unknown, acceptedAt: Date) {
  const parsed = acceptanceSchema.parse(acceptance);
  const first = parsed.evidence[0];
  return { evidenceRefs: parsed.command.consentEvidenceRefs, documents: parsed.evidence.map(item => item.document),
    acceptedAt: first ? first.acceptedAt : acceptedAt.toISOString() };
}
