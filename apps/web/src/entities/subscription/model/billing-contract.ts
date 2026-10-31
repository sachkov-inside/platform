import { coverageSchema } from "@inside/access-capabilities";
import { z } from "zod";
// Словарь прав и вывод состава доступа живут в `@inside/access-capabilities`: покупатель видит
// на витрине ровно то, что сервер потом выдаёт, потому что это один и тот же вывод.
export {
  accessCapabilitySchema,
  accessComposition,
  productCapability,
  isProductCapability,
  type AccessCapability,
} from "@inside/access-capabilities";
import {
  accessCapabilitySchema,
  coverageEntrySchema,
} from "@inside/access-capabilities";

/**
 * Кому Offer продаётся: всем, прежним подписчикам Tribute или только по приглашению. В прежних
 * снимках поля нет, и тогда Offer продаётся всем.
 */
export const offerEligibilitySchema = z.enum([
  "everyone",
  "former_tribute_subscribers",
  "invitation_only",
]);
export type OfferEligibility = z.infer<typeof offerEligibilitySchema>;
/**
 * Форма провода billing, которую читает браузер. Генерируемые типы остаются подсказкой
 * компилятора: адаптеры принимают тело как `unknown` и проверяют его этими схемами.
 */
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
  /** Обратимый признак продажи. В прежних сохранённых снимках может отсутствовать. */
  published: z.boolean().optional(),
  availableForAssignment: z.boolean().optional(),
  coverage: coverageSchema.nullable().optional(),
  eligibility: offerEligibilitySchema.optional(),
});
/** Как продаётся вариант: по расписанию или один раз. Старый снимок без режима — подписка. */
export const paymentModeSchema = z.enum(["subscription", "one_time"]);
export const paymentOptionSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  offerId: z.uuid(),
  mode: paymentModeSchema.optional(),
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
  product: z
    .object({
      id: z.uuid(),
      name: z.string().min(1),
      priceRevision: z.int().positive(),
    })
    .optional(),
  supportMonths: z.literal(3).optional(),
  communityPolicy: z.literal("explicit").optional(),
  offer: offerSchema,
  paymentOption: paymentOptionSchema,
  promotion: promotionSnapshotSchema.nullable(),
  currency: z.literal("RUB"),
  timezone: z.literal("Europe/Moscow"),
  individualPayment: z
    .object({ linkId: z.uuid(), basePriceKopecks: z.int().positive() })
    .optional(),
  firstPriceKopecks: z.number().int().positive(),
  renewalPriceKopecks: z.number().int().positive(),
});
/**
 * Текущий поток продукта из каталога: этап продаж, название, дата старта, событие между
 * потоками и цена после старта. Этап выбирает обещание страницы, но деньги принимает только включённое предложение.
 */
export const cohortStageSchema = z.enum([
  "announcement",
  "preorder",
  "running",
  "between",
]);
export const productSalesStateSchema = z.object({
  productId: z.uuid(),
  revision: z.number().int().positive(),
  name: z.string().min(1),
  stage: cohortStageSchema,
  startsOn: z.iso.date().nullable(),
  nextEvent: z.string(),
  /**
   * Цена после старта в копейках только для витрины: страница показывает её зачёркнутой рядом с
   * ценой предзаказа, а списывается всегда цена предложения. `null` — не показывать. Прежний
   * backend поля не присылает, поэтому его отсутствие читается как `null`.
   */
  priceAfterStartKopecks: z.number().int().positive().nullable().default(null),
});
export const productSalesStatesSchema = z.object({
  items: z.array(productSalesStateSchema),
  nextCursor: z.uuid().nullable(),
});
export type CohortStage = z.infer<typeof cohortStageSchema>;
export type ProductSalesState = z.infer<typeof productSalesStateSchema>;
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

export const attemptKindSchema = z.enum([
  "initial",
  "one_time",
  "renewal",
  "upgrade",
]);
export const attemptStateSchema = z.enum([
  "prepared",
  "sent",
  "unknown",
  "pending",
  "authorized",
  "confirmed",
  "failed",
]);
/**
 * Почему сервер снял покупку до оплаты; деньги не списаны. Первые четыре причины: Init не уходил.
 * `form_address_lost`: Init ушёл, но адреса формы оплаты нет; сервер снял попытку и отменяет её
 * неоплаченную форму в банке (#1926).
 */
export const retirementReasonSchema = z.enum([
  "sale_closed",
  "price_unavailable",
  "already_owned",
  "unsupported_attempt",
  "form_address_lost",
]);
export const noticeKindSchema = z.enum([
  "renewal_reminder",
  "payment_succeeded",
  "payment_failed",
  "renewal_cancelled",
  "access_expired",
  "refund_resolved",
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
export const accessSourceSchema = z.enum([
  "paid",
  "manual",
  "legacy",
  "course_activation",
  "unknown",
]);
export const accessGroundSchema = z.object({
  source: accessSourceSchema,
  content: z.array(coverageEntrySchema).optional(),
  capabilities: z.array(accessCapabilitySchema),
  startsAt: z.iso.datetime().nullable(),
  validUntil: z.iso.datetime().nullable(),
  active: z.boolean(),
});
/** Собственная история списаний: без терминала, окружения и идентификатора платежа. */
export const ownPaymentSchema = z.object({
  purchaseRef: z.uuid(),
  productAccess: z
    .array(
      z.strictObject({
        productId: z.uuid(),
        access: z.enum([
          "awaiting_payment",
          "preparing",
          "review_required",
          "ready",
          "unavailable",
        ]),
      }),
    )
    .optional(),
  content: z.array(coverageEntrySchema).optional(),
  snapshot: priceSnapshotSchema.optional(),
  access: z
    .enum([
      "awaiting_payment",
      "preparing",
      "review_required",
      "ready",
      "unavailable",
    ])
    .optional(),
  kind: attemptKindSchema,
  state: attemptStateSchema,
  amountKopecks: z.number().int().positive(),
  offerName: z.string().min(1),
  months: z.number().int().positive(),
  fiscalization: z.enum(["not_configured", "pending", "confirmed", "failed"]),
  confirmedAt: z.iso.datetime().nullable(),
  periodEndsAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  refundedKopecks: z.number().int().nonnegative().nullable(),
  refundedAt: z.iso.datetime().nullable(),
});
export const ownedProductSchema = z.object({
  id: z.uuid(),
  slug: z.string().nullable(),
  name: z.string(),
  materials: z.object({
    state: z.enum(["available", "expired", "revoked", "unavailable"]),
  }),
  community: z.object({
    state: z.enum(["available", "expired", "revoked", "unavailable"]),
  }),
});
export const currentBillingSchema = z.object({
  products: z.array(ownedProductSchema),
  access: z.object({ grounds: z.array(accessGroundSchema) }),
  notices: z.array(noticeViewSchema),
  payments: z.array(ownPaymentSchema),
});
export type OwnedProduct = z.infer<typeof ownedProductSchema>;

export const purchaseStatusSchema = z.object({
  purchaseRef: z.uuid(),
  state: attemptStateSchema,
  paymentUrl: z.url().nullable(),
  snapshot: priceSnapshotSchema,
  access: z.enum([
    "awaiting_payment",
    "preparing",
    "review_required",
    "ready",
    "unavailable",
  ]),
  refundedKopecks: z.number().int().nonnegative().nullable().optional(),
  fiscalization: z.enum(["not_configured", "pending", "confirmed", "failed"]),
  confirmedAt: z.iso.datetime().nullable(),
  periodEndsAt: z.iso.datetime().nullable(),
  // Ответ без поля читается как покупка, которую не снимали.
  retirementReason: retirementReasonSchema.nullable().default(null),
});
export const quoteSchema = z.object({
  quoteRef: z.uuid(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  snapshot: priceSnapshotSchema.refine(
    (snapshot) =>
      snapshot.product !== undefined && snapshot.supportMonths === 3,
  ),
});
/**
 * Закрытый набор ожидаемых исходов billing. Он приходит из Problem Details бэкенда;
 * `unauthorized` и `unavailable` добавляет граница BFF, у которой своего кода нет.
 */
export const billingFailureCodeSchema = z.enum([
  "invalid_request",
  "forbidden",
  "not_found",
  "operation_conflict",
  "revision_conflict",
  "payment_in_progress",
  "refund_in_progress",
  "state_conflict",
  "reservation_conflict",
  "preview_expired",
  "identity_changed",
  "contact_required",
  "consent_required",
  // Согласие дано на редакцию, которая уже не действует: его нужно принять заново.
  "document_changed",
  "existing_access",
  "legacy_review_required",
  // Offer продаётся только Account с основанием, которого у покупателя нет.
  "not_eligible",
  "quote_expired",
  "quote_changed",
  "unsupported_amount",
  "method_unavailable",
  "provider_unavailable",
  "dependency_unavailable",
  "unauthorized",
  "unavailable",
]);
export const billingFailureSchema = z.object({
  ok: z.literal(false),
  code: billingFailureCodeSchema,
});

export type PaymentMode = z.infer<typeof paymentModeSchema>;
export type AttemptKind = z.infer<typeof attemptKindSchema>;
export type BillingOffer = z.infer<typeof offerSchema>;
export type BillingPaymentOption = z.infer<typeof paymentOptionSchema>;
export type PriceSnapshot = z.infer<typeof priceSnapshotSchema>;
export type OffersPage = z.infer<typeof offersPageSchema>;
export type AttemptState = z.infer<typeof attemptStateSchema>;
export type RetirementReason = z.infer<typeof retirementReasonSchema>;
export type NoticeView = z.infer<typeof noticeViewSchema>;
export type NoticeKind = z.infer<typeof noticeKindSchema>;
export type CurrentBilling = z.infer<typeof currentBillingSchema>;
export type AccessGround = z.infer<typeof accessGroundSchema>;
export type AccessSource = z.infer<typeof accessSourceSchema>;
export type OwnPayment = z.infer<typeof ownPaymentSchema>;
export type PurchaseStatus = z.infer<typeof purchaseStatusSchema>;
export type BillingQuote = z.infer<typeof quoteSchema>;
export type BillingFailureCode = z.infer<typeof billingFailureCodeSchema>;
export type BillingFailure = z.infer<typeof billingFailureSchema>;

/** Способ продажи снимка: у старых снимков его нет, и это подписка. */
export function paymentMode(snapshot: PriceSnapshot): PaymentMode {
  return snapshot.paymentOption.mode ?? "subscription";
}

export type VerifiedContact = z.infer<typeof verifiedContactSchema>;
