import { paymentAuditCursorSchema } from "@inside/contracts/payment-audit";
import { z } from "zod";

import {
  attemptStateSchema,
  priceSnapshotSchema,
} from "@/entities/subscription";

/**
 * Виды платежей владельца billing, как их отдаёт `payments.list` и `payments.read`. Email заказа в
 * них нет и быть не должно: он читается отдельным запросом только на странице платежа.
 */
const attemptKindSchema = z.enum(["initial", "one_time", "renewal", "upgrade"]);

export const paymentAccessSchema = z.enum([
  "awaiting_payment",
  "preparing",
  "review_required",
  "ready",
]);
export type PaymentAccess = z.infer<typeof paymentAccessSchema>;

export const paymentViewSchema = z.object({
  purchaseRef: z.uuid(),
  accountId: z.uuid(),
  kind: attemptKindSchema,
  state: attemptStateSchema,
  subscriptionRef: z.uuid().nullable(),
  periodIndex: z.number().int().positive().nullable(),
  amountKopecks: z.number().int().positive(),
  environment: z.enum(["demo", "production", "local"]),
  terminalRef: z.string(),
  paymentId: z.string().nullable(),
  snapshot: priceSnapshotSchema,
  fiscalization: z.enum(["not_configured", "pending", "confirmed", "failed"]),
  confirmedAt: z.iso.datetime().nullable(),
  periodEndsAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  access: paymentAccessSchema,
  refundedKopecks: z.number().int().nonnegative().nullable(),
  refundableKopecks: z.number().int().nonnegative().nullable(),
});
export type PaymentView = z.infer<typeof paymentViewSchema>;

export const refundDecisionViewSchema = z.object({
  decisionRef: z.uuid(),
  purchaseRef: z.uuid(),
  accountId: z.uuid(),
  actorId: z.uuid().nullable(),
  amountKopecks: z.number().int().positive(),
  basis: z.enum(["withdrawal", "compensation"]).nullable(),
  access: z.enum(["keep", "revoke"]),
  recurring: z.enum(["keep", "cancel"]),
  reason: z.string(),
  state: z.enum(["decided", "executing", "executed", "failed"]),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  attempt: z
    .object({
      refundRef: z.uuid(),
      state: z.enum(["sent", "unknown", "confirmed", "failed"]),
      amountKopecks: z.number().int().positive(),
      observedStatus: z.string().nullable(),
      errorCode: z.string().nullable(),
      updatedAt: z.iso.datetime(),
    })
    .nullable(),
});
export type RefundDecisionView = z.infer<typeof refundDecisionViewSchema>;

export const paymentEventViewSchema = z.object({
  kind: z.string(),
  occurredAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
});
export type PaymentEventView = z.infer<typeof paymentEventViewSchema>;

export const paymentAuditEntrySchema = z.object({
  actorId: z.uuid(),
  operationId: z.uuid(),
  operation: z.string(),
  reason: z.string(),
  createdAt: z.iso.datetime(),
});
export type PaymentAuditEntry = z.infer<typeof paymentAuditEntrySchema>;

const envelope = <Schema extends z.ZodType>(result: Schema) =>
  z.object({ operationRef: z.uuid(), result });

/** Ответ backend на `payments.list`. */
export const paymentsOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("payments"),
    items: z.array(paymentViewSchema),
    nextCursor: z.uuid().nullable(),
  }),
);

/** Ответ backend на `payments.read`: одна страница журнала операций за раз. */
export const paymentOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("payment"),
    value: paymentViewSchema,
    events: z.array(paymentEventViewSchema),
    decisions: z.array(refundDecisionViewSchema),
    nextAuditCursor: paymentAuditCursorSchema.nullable(),
    audit: z.array(paymentAuditEntrySchema),
  }),
);

/** Ответ backend на `payments.reconcile`: платёж после сверки. */
export const reconciledOutcomeSchema = envelope(
  z.object({ outcome: z.literal("reconciled"), value: paymentViewSchema }),
);

/** Ответ backend на `content.list`: продукты и материалы, из которых берутся названия продуктов. */
export const contentOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("content"),
    items: z.array(
      z.object({
        kind: z.enum(["product", "material"]),
        id: z.uuid(),
        title: z.string(),
        available: z.boolean(),
      }),
    ),
  }),
);

/** Страница списка, которую BFF отдаёт браузеру. */
export const paymentsPageSchema = z.object({
  items: z.array(paymentViewSchema),
  nextCursor: z.uuid().nullable(),
});
export type PaymentsPage = z.infer<typeof paymentsPageSchema>;

/** Страница платежа, которую BFF отдаёт браузеру: факт платежа и одна страница журнала. */
export const paymentPageSchema = z.object({
  value: paymentViewSchema,
  events: z.array(paymentEventViewSchema),
  decisions: z.array(refundDecisionViewSchema),
  audit: z.array(paymentAuditEntrySchema),
  /** Позиция следующей страницы журнала или `null`, когда журнал прочитан до конца. */
  nextAuditAfter: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/u)
    .nullable(),
});
export type PaymentPage = z.infer<typeof paymentPageSchema>;

/** Продукт как выбор фильтра: название, а не идентификатор. */
export const paymentProductSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
});
export type PaymentProduct = z.infer<typeof paymentProductSchema>;
export const paymentProductsSchema = z.array(paymentProductSchema);
