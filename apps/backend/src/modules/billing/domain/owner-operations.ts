import { z } from "zod";
import {
  applyGrantBatchCommandSchema, changeAccessGrantCommandSchema, previewGrantBatchCommandSchema,
  accessGrantsViewSchema, classifyLegacyAccountCommandSchema, legacyClassificationViewSchema,
} from "../../membership-entitlements/index.js";
import { manageCatalogSchema, catalogOutcomeSchema } from "../features/manage-catalog/manage-catalog.contract.js";
import { idSchema, moneySchema, priceSnapshotSchema, revisionSchema } from "./pricing.js";
import { attemptKindSchema, attemptStateSchema } from "./payment-attempt.js";
import { subscriptionViewSchema } from "./subscription-change.js";
import type { PaymentFailureCode } from "../features/purchase-subscription/purchase-subscription.contract.js";

export const reasonSchema = z.string().trim().min(1).max(1000);
const command = { operationId: idSchema };
const listBounds = { cursor: idSchema.optional(), limit: z.int().min(1).max(100).default(50) };

/**
 * Владельческие операции billing: один закрытый набор для admin API и MCP. Каталог сохраняет
 * прежние схемы, платежи и возвраты добавляют собственные. Actor приходит из adapter, не из payload.
 */
export const ownerOperationSchema = z.discriminatedUnion("operation", [
  ...manageCatalogSchema.options,
  z.strictObject({ ...command, operation: z.literal("offers.list"), ...listBounds }),
  z.strictObject({ ...command, operation: z.literal("payments.list"), accountId: idSchema.optional(),
    state: attemptStateSchema.optional(), kind: attemptKindSchema.optional(), ...listBounds }),
  z.strictObject({ ...command, operation: z.literal("payments.read"), purchaseRef: idSchema }),
  z.strictObject({ ...command, operation: z.literal("payments.reconcile"), purchaseRef: idSchema }),
  z.strictObject({ ...command, operation: z.literal("subscriptions.cancel"), accountId: idSchema,
    expectedRevision: revisionSchema, reason: reasonSchema }),
  z.strictObject({ ...command, operation: z.literal("refunds.decide"), purchaseRef: idSchema,
    amountKopecks: moneySchema, access: z.enum(["keep", "revoke"]), recurring: z.enum(["keep", "cancel"]), reason: reasonSchema }),
  z.strictObject({ ...command, operation: z.literal("refunds.execute"), decisionRef: idSchema, expectedRevision: revisionSchema }),
  z.strictObject({ ...command, operation: z.literal("refunds.read"), purchaseRef: idSchema }),
  z.strictObject({ ...command, operation: z.literal("grants.read"), accountId: idSchema }),
  z.strictObject({ ...command, operation: z.literal("grants.readClassification"), accountId: idSchema }),
  // Кросс-полевые правила команды и её строк остаются за владеющим use case: он повторно разбирает команду.
  z.strictObject({ ...classifyLegacyAccountCommandSchema.shape, operation: z.literal("grants.classify") }),
  z.strictObject({ ...previewGrantBatchCommandSchema.shape, operation: z.literal("grants.previewBatch") }),
  z.strictObject({ ...applyGrantBatchCommandSchema.shape, operation: z.literal("grants.applyBatch") }),
  z.strictObject({ ...changeAccessGrantCommandSchema.options[0].omit({ action: true }).shape, operation: z.literal("grants.extend") }),
  z.strictObject({ ...changeAccessGrantCommandSchema.options[1].omit({ action: true }).shape, operation: z.literal("grants.revoke") }),
]);
export type OwnerOperation = z.infer<typeof ownerOperationSchema>;
/** Чтение не меняет состояние: такие операции не пишут receipt и повторяются свободно. */
export const ownerReadOperations = ["offers.list", "payments.list", "payments.read", "refunds.read", "grants.read",
  "grants.readClassification"] as const;
const readOperations: readonly string[] = ownerReadOperations;
export function isOwnerReadOperation(operation: string): boolean {
  return readOperations.includes(operation);
}

export const paymentViewSchema = z.strictObject({
  purchaseRef: idSchema, accountId: idSchema, kind: attemptKindSchema, state: attemptStateSchema,
  subscriptionRef: idSchema.nullable(), periodIndex: z.int().positive().nullable(),
  amountKopecks: moneySchema, environment: z.enum(["demo", "production"]), terminalRef: z.string(),
  paymentId: z.string().nullable(), snapshot: priceSnapshotSchema,
  fiscalization: z.enum(["not_configured", "pending", "confirmed", "failed"]),
  confirmedAt: z.iso.datetime().nullable(), periodEndsAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  /** Готовность доступа отделена от банковского состояния. */
  access: z.enum(["awaiting_payment", "preparing", "ready"]),
  refundedKopecks: z.int().nonnegative(), refundableKopecks: z.int().nonnegative(),
});
export const paymentEventViewSchema = z.strictObject({
  kind: z.string(), occurredAt: z.iso.datetime(), recordedAt: z.iso.datetime(),
});
export const refundDecisionViewSchema = z.strictObject({
  decisionRef: idSchema, purchaseRef: idSchema, accountId: idSchema, actorId: idSchema,
  amountKopecks: moneySchema, access: z.enum(["keep", "revoke"]), recurring: z.enum(["keep", "cancel"]),
  reason: z.string(), state: z.enum(["decided", "executing", "executed", "failed"]), revision: revisionSchema,
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  attempt: z.strictObject({ refundRef: idSchema, state: z.enum(["sent", "unknown", "confirmed", "failed"]),
    amountKopecks: moneySchema, observedStatus: z.string().nullable(), errorCode: z.string().nullable(),
    updatedAt: z.iso.datetime() }).nullable(),
});
export const auditEntryViewSchema = z.strictObject({
  actorId: idSchema, operationId: idSchema, operation: z.string().min(1).max(80),
  reason: z.string(), createdAt: z.iso.datetime(),
});

export const ownerSuccessSchema = z.union([
  z.strictObject({ outcome: z.literal("catalog"), value: catalogOutcomeSchema }),
  z.strictObject({ outcome: z.literal("catalogOffers"), items: z.array(priceSnapshotSchema), nextCursor: idSchema.nullable() }),
  z.strictObject({ outcome: z.literal("payments"), items: z.array(paymentViewSchema), nextCursor: idSchema.nullable() }),
  z.strictObject({ outcome: z.literal("payment"), value: paymentViewSchema, events: z.array(paymentEventViewSchema),
    decisions: z.array(refundDecisionViewSchema), audit: z.array(auditEntryViewSchema) }),
  z.strictObject({ outcome: z.literal("reconciled"), value: paymentViewSchema }),
  z.strictObject({ outcome: z.literal("subscription"), value: subscriptionViewSchema }),
  z.strictObject({ outcome: z.literal("refundDecision"), value: refundDecisionViewSchema }),
  z.strictObject({ outcome: z.literal("refunds"), purchaseRef: idSchema, refundedKopecks: z.int().nonnegative(),
    refundableKopecks: z.int().nonnegative(), decisions: z.array(refundDecisionViewSchema) }),
  z.strictObject({ outcome: z.literal("grants"), value: accessGrantsViewSchema }),
  z.strictObject({ outcome: z.literal("classification"), value: legacyClassificationViewSchema }),
  z.strictObject({ outcome: z.literal("grantPreview"), previewRef: idSchema, revision: revisionSchema,
    expiresAt: z.iso.datetime(), rows: z.array(z.strictObject({ rowKey: z.string(), accountId: idSchema,
      status: z.enum(["confirmed", "not_found"]) })) }),
  z.strictObject({ outcome: z.literal("grantBatch"), rows: z.array(z.strictObject({ rowKey: z.string(),
    result: z.union([z.strictObject({ ok: z.literal(true), grantRef: idSchema, revision: revisionSchema }),
      z.strictObject({ ok: z.literal(true), classification: legacyClassificationViewSchema.shape.classification, revision: revisionSchema }),
      z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: z.literal("operation_conflict") }) })]) })) }),
  z.strictObject({ outcome: z.literal("grant"), grantRef: idSchema, revision: revisionSchema }),
]);
export type OwnerOutcome = z.infer<typeof ownerSuccessSchema>;

export const ownerFailureCodes = ["invalid_request", "forbidden", "not_found", "operation_conflict", "revision_conflict",
  "payment_in_progress", "refund_in_progress", "state_conflict", "reservation_conflict", "preview_expired",
  "identity_changed", "unsupported_amount", "method_unavailable", "provider_unavailable", "dependency_unavailable"] as const;
export type OwnerFailureCode = typeof ownerFailureCodes[number];
export const ownerResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), operationRef: idSchema, result: ownerSuccessSchema }),
  z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: z.enum(ownerFailureCodes) }) }),
]);
export type OwnerResult = z.infer<typeof ownerResultSchema>;
/** Успешный ответ транспорта: ссылка на операцию и её результат; ошибка остаётся HTTP/tool ошибкой. */
export const ownerResponseSchema = z.strictObject({ operationRef: idSchema, result: ownerSuccessSchema });
export function ownerFailure(code: OwnerFailureCode): Extract<OwnerResult, { ok: false }> {
  return { ok: false, error: { code } };
}

/** Ошибка исходного use case переносится без потери смысла; неожидаемый код не маскируется. */
export function ownerPaymentFailure(code: PaymentFailureCode): Extract<OwnerResult, { ok: false }> {
  switch (code) {
    case "invalid_request": case "invalid_notification": return ownerFailure("invalid_request");
    case "forbidden": return ownerFailure("forbidden");
    case "not_found": return ownerFailure("not_found");
    case "operation_conflict": return ownerFailure("operation_conflict");
    case "revision_conflict": return ownerFailure("revision_conflict");
    case "payment_in_progress": return ownerFailure("payment_in_progress");
    case "contact_required": case "consent_required": case "existing_access":
    case "legacy_review_required": case "quote_expired": case "quote_changed": return ownerFailure("state_conflict");
    case "unsupported_amount": return ownerFailure("unsupported_amount");
    case "method_unavailable": return ownerFailure("method_unavailable");
    case "provider_unavailable": return ownerFailure("provider_unavailable");
    case "dependency_unavailable": return ownerFailure("dependency_unavailable");
    default: { const exhaustive: never = code; throw new Error(`Unknown billing failure ${String(exhaustive)}`); }
  }
}
/** Ошибки прав переносятся в тот же закрытый набор без потери смысла. */
export type AccessFailureCode = "invalid_input" | "not_found" | "revision_conflict" | "operation_conflict"
  | "forbidden" | "unavailable" | "preview_expired" | "identity_changed";
export function ownerAccessFailure(code: AccessFailureCode): Extract<OwnerResult, { ok: false }> {
  switch (code) {
    case "invalid_input": return ownerFailure("invalid_request");
    case "unavailable": return ownerFailure("dependency_unavailable");
    case "not_found": case "revision_conflict": case "operation_conflict": case "forbidden":
    case "preview_expired": case "identity_changed": return ownerFailure(code);
    default: { const exhaustive: never = code; throw new Error(`Unknown access failure ${String(exhaustive)}`); }
  }
}

