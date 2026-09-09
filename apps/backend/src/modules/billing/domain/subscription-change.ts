import { z } from "zod";
import { idSchema, moneySchema, offerSchema, optionSchema, priceSnapshotSchema, revisionSchema, type PriceSnapshot } from "./pricing.js";

export const subscriptionStateSchema = z.enum(["active", "canceled", "ended"]);
export const subscriptionEventKinds = ["subscription_started", "period_renewed", "option_upgraded", "subscription_ended",
  "renewal_canceled", "renewal_resumed", "change_scheduled", "change_canceled", "method_changed", "method_revoked"] as const;
export type SubscriptionEventKind = typeof subscriptionEventKinds[number];
export const subscriptionEndReasons = ["renewal_declined", "payment_method_unavailable", "canceled_period_ended", "no_usable_payment_method"] as const;
export type SubscriptionEndReason = typeof subscriptionEndReasons[number];
export const attemptKindSchema = z.enum(["initial", "renewal", "upgrade"]);
export const attemptStateSchema = z.enum(["prepared", "sent", "unknown", "pending", "authorized", "confirmed", "failed"]);
export type AttemptKind = z.infer<typeof attemptKindSchema>;
export const changePlanSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("upgrade"), snapshot: priceSnapshotSchema, topUpKopecks: moneySchema, effectiveAt: z.iso.datetime() }),
  z.strictObject({ kind: z.literal("scheduled"), snapshot: priceSnapshotSchema, nextPriceKopecks: moneySchema, effectiveAt: z.iso.datetime() }),
]);
export type ChangePlan = z.infer<typeof changePlanSchema>;
export const pendingChangeSchema = z.strictObject({ snapshot: priceSnapshotSchema, acceptedAt: z.iso.datetime(), changeQuoteRef: idSchema });
export const subscriptionConsentSchema = z.strictObject({
  evidenceRefs: z.array(idSchema).min(1).max(4),
  documents: z.array(z.strictObject({ kind: z.string().min(1).max(40), documentId: z.string().min(1).max(200), version: z.string().min(1).max(80), digest: z.string().length(64) })).min(1).max(4),
  acceptedAt: z.iso.datetime(),
});
export type SubscriptionConsent = z.infer<typeof subscriptionConsentSchema>;
export const subscriptionSnapshotSchema = z.strictObject({
  offer: offerSchema, paymentOption: optionSchema, currency: z.literal("RUB"), timezone: z.literal("Europe/Moscow"),
  renewalPriceKopecks: moneySchema,
});

function floorDivide(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return numerator % denominator !== 0n && numerator < 0n !== denominator < 0n ? quotient - 1n : quotient;
}

/**
 * Доплата за оставшуюся часть текущего периода: цена старшего варианта за остаток минус
 * остаток фактически оплаченной суммы. Половина копейки округляется вверх один раз на итоге.
 */
export function upgradeTopUpKopecks(input: {
  readonly targetPriceKopecks: number; readonly paidPeriodKopecks: number;
  readonly periodStartsAt: Date; readonly paidUntil: Date; readonly now: Date;
}): number {
  const total = BigInt(input.paidUntil.getTime() - input.periodStartsAt.getTime());
  if (total <= 0n) throw new Error("Invalid subscription period");
  const elapsed = BigInt(input.now.getTime() - input.periodStartsAt.getTime());
  const remaining = elapsed <= 0n ? total : elapsed >= total ? 0n : total - elapsed;
  const difference = BigInt(input.targetPriceKopecks) - BigInt(input.paidPeriodKopecks);
  return Number(floorDivide(difference * remaining * 2n + total, total * 2n));
}

/**
 * Повышение сохраняет срок и длительность; понижение и другая длительность вступают
 * в силу следующим периодом.
 */
export function planSubscriptionChange(input: {
  readonly currentMonths: number; readonly targetMonths: number;
  readonly targetPriceKopecks: number; readonly paidPeriodKopecks: number;
  readonly periodStartsAt: Date; readonly paidUntil: Date; readonly now: Date;
}): { readonly kind: "upgrade"; readonly topUpKopecks: number } | { readonly kind: "scheduled" } {
  if (input.currentMonths !== input.targetMonths) return { kind: "scheduled" };
  const topUpKopecks = upgradeTopUpKopecks(input);
  return topUpKopecks > 0 ? { kind: "upgrade", topUpKopecks } : { kind: "scheduled" };
}

/**
 * Цена продления берётся из принятых условий подписки, а не из публичного каталога.
 * Согласованное изменение варианта применяется следующим периодом.
 */
export function renewalPriceSnapshot(snapshot: unknown, pendingChange: unknown): PriceSnapshot {
  const pending = pendingChangeSchema.safeParse(pendingChange);
  if (pending.success) return pending.data.snapshot;
  const current = subscriptionSnapshotSchema.parse(snapshot);
  return priceSnapshotSchema.parse({ offer: current.offer, paymentOption: current.paymentOption, promotion: null,
    currency: current.currency, timezone: current.timezone,
    firstPriceKopecks: current.renewalPriceKopecks, renewalPriceKopecks: current.renewalPriceKopecks });
}

/** Условия расчёта: конкретные редакции предложения и варианта с их ценой. */
export function sameChangeConditions(left: PriceSnapshot, right: PriceSnapshot): boolean {
  return left.offer.id === right.offer.id && left.offer.revision === right.offer.revision
    && left.paymentOption.id === right.paymentOption.id && left.paymentOption.revision === right.paymentOption.revision
    && left.paymentOption.priceKopecks === right.paymentOption.priceKopecks;
}

export const subscriptionViewSchema = z.strictObject({
  subscriptionRef: idSchema, revision: revisionSchema, state: subscriptionStateSchema,
  snapshot: subscriptionSnapshotSchema, periodStartsAt: z.iso.datetime(), paidUntil: z.iso.datetime(),
  /** Цена, по которой держится текущий период: после повышения это цена нового варианта. */
  periodAmountKopecks: moneySchema, periodIndex: revisionSchema,
  paymentMethod: z.strictObject({ methodRef: idSchema, revoked: z.boolean() }).nullable(),
  pendingChange: pendingChangeSchema.nullable(),
  pendingMethodChange: z.strictObject({ flowRef: idSchema, formUrl: z.url().nullable() }).nullable(),
  inFlightPayment: z.strictObject({ attemptRef: idSchema, kind: attemptKindSchema, state: attemptStateSchema }).nullable(),
});
export type SubscriptionView = z.infer<typeof subscriptionViewSchema>;
