import { paymentAuditCursorSchema } from "@inside/contracts/payment-audit";
import { z } from "zod";

import {
  attemptStateSchema,
  cohortStageSchema,
  priceSnapshotSchema,
} from "@/entities/subscription";

const operationId = z.uuid();
const revision = z.number().int().positive();
const money = z.number().int().positive();
const instant = z.iso.datetime({ offset: true });

export const savePromotionInputSchema = z.strictObject({
  operationId,
  expectedRevision: revision.optional(),
  value: z.strictObject({
    id: z.uuid(),
    name: z.string().trim().min(1).max(200),
    percent: z.number().int().min(1).max(100),
    code: z.string().trim().min(1).max(100).nullable(),
    startsAt: instant,
    endsAt: instant,
    productIds: z.array(z.uuid()).max(100),
    usageLimit: revision.nullable(),
  }),
});
/**
 * Поток продукта задаётся целиком: этап, название, дата старта, событие между потоками и цена
 * после старта. Пустая цена после старта — `null`, страница её не показывает.
 */
export const saveCohortInputSchema = z.strictObject({
  operationId,
  expectedRevision: revision.optional(),
  value: z.strictObject({
    productId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    stage: cohortStageSchema,
    startsOn: z.iso.date().nullable(),
    nextEvent: z.string().trim().max(200),
    priceAfterStartKopecks: money.nullable(),
  }),
});
/**
 * Рубли из поля формы в копейки команды: «39900», «39 900» или «39 900,50». Пустое поле — `null`,
 * то есть цена не показывается; ноль, минус и лишние знаки после запятой — ошибка формы.
 */
export function parseRublesToKopecks(
  text: string,
):
  | { readonly ok: true; readonly kopecks: number | null }
  | { readonly ok: false } {
  const entry = text.replace(/[\s\u00a0\u202f]/gu, "");
  if (entry.length === 0) return { ok: true, kopecks: null };
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/u.exec(entry);
  if (match === null) return { ok: false };
  const kopecks =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  // Целое положительное и безопасное для JSON: так же сумму проверяет команда.
  return money.safeParse(kopecks).success
    ? { ok: true, kopecks }
    : { ok: false };
}

/** Копейки обратно в рубли для поля формы: «39900» или «39900,50». */
export function kopecksToRublesText(kopecks: number): string {
  const rubles = Math.trunc(kopecks / 100);
  const fraction = kopecks % 100;
  return fraction === 0
    ? String(rubles)
    : `${String(rubles)},${String(fraction).padStart(2, "0")}`;
}

export const archiveInputSchema = z.strictObject({
  operationId,
  expectedRevision: revision,
  id: z.uuid(),
});
export const listPaymentsInputSchema = z.strictObject({
  operationId,
  accountId: z.uuid().optional(),
  state: attemptStateSchema.optional(),
  kind: z.enum(["initial", "one_time", "renewal", "upgrade"]).optional(),
  cursor: z.uuid().optional(),
  limit: z.number().int().min(1).max(100),
});
export const purchaseInputSchema = z.strictObject({
  operationId,
  purchaseRef: z.uuid(),
});
export const readPaymentInputSchema = purchaseInputSchema.extend({
  auditCursor: paymentAuditCursorSchema.optional(),
});
const envelope = <Schema extends z.ZodType>(result: Schema) =>
  z.object({ operationRef: z.uuid(), result });

export const catalogOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("catalog"),
    value: z.object({
      id: z.uuid(),
      revision,
      archived: z.boolean(),
      published: z.boolean().optional(),
    }),
  }),
);
export const ownerCatalogSchema = z.array(priceSnapshotSchema);
export const catalogOffersOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("catalogOffers"),
    items: z.array(priceSnapshotSchema),
    nextCursor: z.uuid().nullable(),
  }),
);
export const paymentViewSchema = z.object({
  purchaseRef: z.uuid(),
  accountId: z.uuid(),
  kind: z.enum(["initial", "one_time", "renewal", "upgrade"]),
  state: attemptStateSchema,
  subscriptionRef: z.uuid().nullable(),
  periodIndex: z.number().int().positive().nullable(),
  amountKopecks: money,
  environment: z.enum(["demo", "production", "local"]),
  terminalRef: z.string(),
  paymentId: z.string().nullable(),
  snapshot: priceSnapshotSchema,
  fiscalization: z.enum(["not_configured", "pending", "confirmed", "failed"]),
  confirmedAt: z.iso.datetime().nullable(),
  periodEndsAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  access: z.enum(["awaiting_payment", "preparing", "review_required", "ready"]),
  refundedKopecks: z.number().int().nonnegative().nullable(),
  refundableKopecks: z.number().int().nonnegative().nullable(),
});
export const refundDecisionViewSchema = z.object({
  decisionRef: z.uuid(),
  purchaseRef: z.uuid(),
  accountId: z.uuid(),
  actorId: z.uuid().nullable(),
  amountKopecks: money,
  basis: z.enum(["withdrawal", "compensation"]).nullable(),
  access: z.enum(["keep", "revoke"]),
  recurring: z.enum(["keep", "cancel"]),
  reason: z.string(),
  state: z.enum(["decided", "executing", "executed", "failed"]),
  revision,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  attempt: z
    .object({
      refundRef: z.uuid(),
      state: z.enum(["sent", "unknown", "confirmed", "failed"]),
      amountKopecks: money,
      observedStatus: z.string().nullable(),
      errorCode: z.string().nullable(),
      updatedAt: z.iso.datetime(),
    })
    .nullable(),
});
export const paymentsOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("payments"),
    items: z.array(paymentViewSchema),
    nextCursor: z.uuid().nullable(),
  }),
);
export const paymentOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("payment"),
    value: paymentViewSchema,
    events: z.array(
      z.object({
        kind: z.string(),
        occurredAt: z.iso.datetime(),
        recordedAt: z.iso.datetime(),
      }),
    ),
    decisions: z.array(refundDecisionViewSchema),
    nextAuditCursor: paymentAuditCursorSchema.nullable(),
    audit: z.array(
      z.object({
        actorId: z.uuid(),
        operationId: z.uuid(),
        operation: z.string(),
        reason: z.string(),
        createdAt: z.iso.datetime(),
      }),
    ),
  }),
);
export const reconciledOutcomeSchema = envelope(
  z.object({ outcome: z.literal("reconciled"), value: paymentViewSchema }),
);
export const refundsOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("refunds"),
    purchaseRef: z.uuid(),
    refundedKopecks: z.number().int().nonnegative().nullable(),
    refundableKopecks: z.number().int().nonnegative().nullable(),
    decisions: z.array(refundDecisionViewSchema),
  }),
);
export type SavePromotionInput = z.infer<typeof savePromotionInputSchema>;
export type SaveCohortInput = z.infer<typeof saveCohortInputSchema>;
export type ArchiveInput = z.infer<typeof archiveInputSchema>;
export type ListPaymentsInput = z.infer<typeof listPaymentsInputSchema>;
export type ReadPaymentInput = z.infer<typeof readPaymentInputSchema>;
export type PurchaseCommandInput = z.infer<typeof purchaseInputSchema>;
export type CatalogOutcome = z.infer<typeof catalogOutcomeSchema>;
export type PaymentView = z.infer<typeof paymentViewSchema>;
export type PaymentsOutcome = z.infer<typeof paymentsOutcomeSchema>;
export type PaymentOutcome = z.infer<typeof paymentOutcomeSchema>;
export type ReconciledOutcome = z.infer<typeof reconciledOutcomeSchema>;
export type RefundsOutcome = z.infer<typeof refundsOutcomeSchema>;
export type RefundDecisionView = z.infer<typeof refundDecisionViewSchema>;
