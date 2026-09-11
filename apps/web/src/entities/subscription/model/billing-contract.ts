import { z } from "zod";

/**
 * Форма провода billing, которую читает браузер. Генерируемые типы остаются подсказкой
 * компилятора: адаптеры принимают тело как `unknown` и проверяют его этими схемами.
 */
export const globalAccessCapabilities = [
  "materials",
  "community",
  "reviews",
  "support",
] as const;
export const accessCapabilitySchema = z.union([
  z.enum(globalAccessCapabilities),
  z.templateLiteral(["guide:", z.uuid()]),
]);
export const offerSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  name: z.string().min(1),
  benefits: z.array(accessCapabilitySchema),
  benefitPeriods: z
    .array(
      z.object({
        capability: accessCapabilitySchema,
        months: z.number().int().positive().nullable(),
      }),
    )
    .optional(),
  archived: z.boolean(),
});
export const paymentOptionSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  offerId: z.uuid(),
  mode: z.literal("subscription").optional(),
  months: z.number().int().positive(),
  priceKopecks: z.number().int().positive(),
  archived: z.boolean(),
});
export const promotionSnapshotSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  name: z.string(),
  percent: z.number().int().min(1).max(100),
});
export const priceSnapshotSchema = z.object({
  offer: offerSchema,
  paymentOption: paymentOptionSchema,
  promotion: promotionSnapshotSchema.nullable(),
  currency: z.literal("RUB"),
  timezone: z.literal("Europe/Moscow"),
  firstPriceKopecks: z.number().int().positive(),
  renewalPriceKopecks: z.number().int().positive(),
});
export const offersPageSchema = z.object({
  items: z.array(priceSnapshotSchema),
  nextCursor: z.uuid().nullable(),
});

/** Подтверждённый контакт для чеков: собственный факт Account, а не способ входа. */
export const verifiedContactSchema = z.object({
  email: z.email(),
  revision: z.number().int().nonnegative().max(2_147_483_646),
  verifiedAt: z.iso.datetime(),
});

export const attemptKindSchema = z.enum(["initial", "renewal", "upgrade"]);
export const attemptStateSchema = z.enum([
  "prepared", "sent", "unknown", "pending", "authorized", "confirmed", "failed",
]);
export const subscriptionStateSchema = z.enum(["active", "canceled", "ended"]);
export const subscriptionSnapshotSchema = z.object({
  offer: offerSchema,
  paymentOption: paymentOptionSchema,
  currency: z.literal("RUB"),
  timezone: z.literal("Europe/Moscow"),
  renewalPriceKopecks: z.number().int().positive(),
});
export const subscriptionViewSchema = z.object({
  subscriptionRef: z.uuid(),
  revision: z.number().int().positive(),
  state: subscriptionStateSchema,
  snapshot: subscriptionSnapshotSchema,
  periodStartsAt: z.iso.datetime(),
  paidUntil: z.iso.datetime(),
  periodAmountKopecks: z.number().int().positive(),
  periodIndex: z.number().int().positive(),
  paymentMethod: z.object({ methodRef: z.uuid(), revoked: z.boolean() }).nullable(),
  pendingChange: z
    .object({
      snapshot: priceSnapshotSchema,
      acceptedAt: z.iso.datetime(),
      changeQuoteRef: z.uuid(),
    })
    .nullable(),
  pendingMethodChange: z
    .object({ flowRef: z.uuid(), formUrl: z.url().nullable() })
    .nullable(),
  inFlightPayment: z
    .object({
      attemptRef: z.uuid(),
      kind: attemptKindSchema,
      state: attemptStateSchema,
    })
    .nullable(),
});
export const noticeKindSchema = z.enum([
  "renewal_reminder", "payment_succeeded", "payment_failed",
  "renewal_cancelled", "access_expired", "refund_resolved",
]);
export const noticeViewSchema = z.object({
  noticeRef: z.uuid(),
  kind: noticeKindSchema,
  state: z.enum(["current", "superseded"]),
  occurredAt: z.iso.datetime(),
  amountKopecks: z.number().int().positive().nullable(),
  dueAt: z.iso.datetime().nullable(),
});
/**
 * Собственное основание доступа: состав, срок и то, чем оно выдано. Ручная выдача остаётся
 * выдачей и не называется покупкой.
 */
export const accessSourceSchema = z.enum(["paid", "manual", "legacy"]);
export const accessGroundSchema = z.object({
  source: accessSourceSchema,
  capabilities: z.array(accessCapabilitySchema),
  startsAt: z.iso.datetime(),
  validUntil: z.iso.datetime().nullable(),
  active: z.boolean(),
});
/** Собственная история списаний: без терминала, окружения и идентификатора платежа. */
export const ownPaymentSchema = z.object({
  purchaseRef: z.uuid(),
  kind: attemptKindSchema,
  state: attemptStateSchema,
  amountKopecks: z.number().int().positive(),
  offerName: z.string().min(1),
  months: z.number().int().positive(),
  fiscalization: z.enum(["not_configured", "pending", "confirmed", "failed"]),
  confirmedAt: z.iso.datetime().nullable(),
  periodEndsAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export const currentBillingSchema = z.object({
  subscription: subscriptionViewSchema.nullable(),
  notices: z.array(noticeViewSchema),
  grounds: z.array(accessGroundSchema),
  payments: z.array(ownPaymentSchema),
});

export const purchaseStatusSchema = z.object({
  purchaseRef: z.uuid(),
  state: attemptStateSchema,
  paymentUrl: z.url().nullable(),
  snapshot: priceSnapshotSchema,
  access: z.enum(["awaiting_payment", "preparing", "ready"]),
  fiscalization: z.enum(["not_configured", "pending", "confirmed", "failed"]),
  confirmedAt: z.iso.datetime().nullable(),
  periodEndsAt: z.iso.datetime().nullable(),
});
export const quoteSchema = z.object({
  quoteRef: z.uuid(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  snapshot: priceSnapshotSchema,
});
export const changePlanSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("upgrade"),
    snapshot: priceSnapshotSchema,
    topUpKopecks: z.number().int().positive(),
    effectiveAt: z.iso.datetime(),
  }),
  z.object({
    kind: z.literal("scheduled"),
    snapshot: priceSnapshotSchema,
    nextPriceKopecks: z.number().int().positive(),
    effectiveAt: z.iso.datetime(),
  }),
]);
export const changeQuoteSchema = z.object({
  changeQuoteRef: z.uuid(),
  baseRevision: z.number().int().positive(),
  plan: changePlanSchema,
  expiresAt: z.iso.datetime(),
});
export const changeResultSchema = z.object({
  subscription: subscriptionViewSchema,
  payment: purchaseStatusSchema.nullable(),
});

/**
 * Закрытый набор ожидаемых исходов billing. Он приходит из Problem Details бэкенда;
 * `unauthorized` и `unavailable` добавляет граница BFF, у которой своего кода нет.
 */
export const billingFailureCodeSchema = z.enum([
  "invalid_request", "forbidden", "not_found", "operation_conflict", "revision_conflict",
  "payment_in_progress", "refund_in_progress", "state_conflict", "reservation_conflict",
  "preview_expired", "identity_changed", "contact_required", "consent_required",
  "existing_access", "legacy_review_required", "quote_expired", "quote_changed",
  "unsupported_amount", "method_unavailable", "provider_unavailable", "dependency_unavailable",
  "unauthorized", "unavailable",
]);
export const billingFailureSchema = z.object({
  ok: z.literal(false),
  code: billingFailureCodeSchema,
});

export type AccessCapability = z.infer<typeof accessCapabilitySchema>;
export type BillingOffer = z.infer<typeof offerSchema>;
export type BillingPaymentOption = z.infer<typeof paymentOptionSchema>;
export type PriceSnapshot = z.infer<typeof priceSnapshotSchema>;
export type OffersPage = z.infer<typeof offersPageSchema>;
export type SubscriptionView = z.infer<typeof subscriptionViewSchema>;
export type SubscriptionState = z.infer<typeof subscriptionStateSchema>;
export type AttemptState = z.infer<typeof attemptStateSchema>;
export type NoticeView = z.infer<typeof noticeViewSchema>;
export type NoticeKind = z.infer<typeof noticeKindSchema>;
export type CurrentBilling = z.infer<typeof currentBillingSchema>;
export type AccessGround = z.infer<typeof accessGroundSchema>;
export type AccessSource = z.infer<typeof accessSourceSchema>;
export type OwnPayment = z.infer<typeof ownPaymentSchema>;
export type PurchaseStatus = z.infer<typeof purchaseStatusSchema>;
export type BillingQuote = z.infer<typeof quoteSchema>;
export type ChangeQuote = z.infer<typeof changeQuoteSchema>;
export type ChangePlan = z.infer<typeof changePlanSchema>;
export type ChangeResult = z.infer<typeof changeResultSchema>;
export type BillingFailureCode = z.infer<typeof billingFailureCodeSchema>;
export type BillingFailure = z.infer<typeof billingFailureSchema>;

/**
 * Отдельное право на руководство выдаётся контролируемо, поэтому публичной продажи у него нет.
 * Снятые с продажи позиции тоже не выводятся. Остальной состав каталога страница не выбирает:
 * две карточки не зашиты как единственная модель.
 */
export function publicSubscriptionOffers(
  offers: readonly PriceSnapshot[],
): readonly PriceSnapshot[] {
  return offers.filter(
    (snapshot) =>
      !snapshot.offer.archived &&
      !snapshot.paymentOption.archived &&
      !snapshot.offer.benefits.every((capability) =>
        capability.startsWith("guide:"),
      ),
  );
}
export type VerifiedContact = z.infer<typeof verifiedContactSchema>;
