import { coverageEntrySchema } from "@inside/access-capabilities";
import { paymentAuditCursorSchema } from "@inside/contracts/payment-audit";
import { z } from "zod";
import {
  activationRuleSchema,
  manageActivationRuleSchema,
} from "../../account-rights/index.js";
import {
  catalogOutcomeSchema,
  manageCatalogSchema,
} from "../features/manage-catalog/manage-catalog.contract.js";
import {
  promotionListItemSchema,
  promotionsListShape,
} from "../features/list-promotions/list-promotions.contract.js";
import {
  paymentLinkCommandSchema,
  paymentLinksListSchema,
  paymentLinkViewSchema,
  paymentLinksPageSchema,
} from "../features/payment-links/payment-links.contract.js";
import type { PaymentFailureCode } from "../features/purchase-product/purchase-product.contract.js";
import {
  importRespondentsSchema,
  issueRespondentLinkSchema,
  respondentImportSchema,
  respondentLinkSchema,
  respondentsViewSchema,
} from "../features/survey-respondents/survey-respondents.contract.js";
import { attemptKindSchema, attemptStateSchema } from "./payment-attempt.js";
import {
  idSchema,
  moneySchema,
  priceSnapshotSchema,
  revisionSchema,
} from "./pricing.js";
import { listCursorSchema } from "../shared/list-cursor.js";

export const reasonSchema = z.string().trim().min(1).max(1000);
const command = { operationId: idSchema };
const listBounds = {
  cursor: idSchema.optional(),
  limit: z.int().min(1).max(100).default(50),
};

/**
 * Основание возврата. Отказ от договора прекращает права покупки; компенсация без отказа доступ
 * сохраняет. Судьба доступа выводится из основания и отдельно не выбирается.
 */
export const refundBasisSchema = z.enum(["withdrawal", "compensation"]);
export type RefundBasis = z.infer<typeof refundBasisSchema>;
export const refundAccessSchema = z.enum(["keep", "revoke"]);
export type RefundAccess = z.infer<typeof refundAccessSchema>;
export function refundAccessFor(_basis: RefundBasis): RefundAccess {
  return "keep";
}

/**
 * Владельческие операции billing: один закрытый набор для admin API и MCP. Каталог сохраняет
 * прежние схемы, платежи и возвраты добавляют собственные. Actor приходит из adapter, не из payload.
 */
export const ownerOperationSchema = z.discriminatedUnion("operation", [
  ...paymentLinkCommandSchema.options,
  z.strictObject({
    ...command,
    operation: z.literal("paymentLinks.list"),
    ...paymentLinksListSchema.shape,
  }),
  z.strictObject({
    ...command,
    operation: z.literal("recipients.lookup"),
    identityRef: z.string().trim().min(1).max(256),
  }),
  ...manageCatalogSchema.options,
  z.strictObject({
    ...command,
    operation: z.literal("productPrices.list"),
    productId: idSchema.optional(),
    ...listBounds,
  }),
  z.strictObject({
    ...command,
    operation: z.literal("promotions.list"),
    ...promotionsListShape,
  }),
  z.strictObject({ ...command, operation: z.literal("content.list") }),
  z.strictObject({
    ...manageActivationRuleSchema.shape,
    operation: z.literal("activationRules.save"),
  }),
  z.strictObject({ ...command, operation: z.literal("activationRules.list") }),
  z.strictObject({
    ...command,
    operation: z.literal("payments.list"),
    accountId: idSchema.optional(),
    /** Продукт из оплаченного снимка; историческая покупка без продукта в снимке не выбирается. */
    productId: idSchema.optional(),
    state: attemptStateSchema.optional(),
    /** Несколько состояний сразу, без повторов; вместе с `state` не принимается. */
    states: z.array(attemptStateSchema).min(1).max(7).optional(),
    kind: attemptKindSchema.optional(),
    /**
     * `incomplete`: подтверждённый платёж, выдача которого ещё не применена (в очереди выдачи есть
     * строка без `appliedAt`, в том числе требующая разбора). Как и состояние, со временем меняется.
     */
    fulfillment: z.literal("incomplete").optional(),
    /** Период создания `[from, to)`; `from` раньше `to`. */
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    ...listBounds,
  }),
  z.strictObject({
    ...command,
    operation: z.literal("payments.read"),
    purchaseRef: idSchema,
    auditCursor: paymentAuditCursorSchema.optional(),
  }),
  z.strictObject({
    ...command,
    operation: z.literal("payments.reconcile"),
    purchaseRef: idSchema,
  }),
  z.strictObject({
    ...command,
    operation: z.literal("refunds.read"),
    purchaseRef: idSchema,
  }),
  // Скидка респондентам анкеты (#815): список ников и личные одноразовые ссылки.
  z.strictObject({
    ...importRespondentsSchema.shape,
    operation: z.literal("respondents.import"),
  }),
  z.strictObject({
    ...issueRespondentLinkSchema.shape,
    operation: z.literal("respondents.issue"),
  }),
  z.strictObject({ ...command, operation: z.literal("respondents.status") }),
]);
export type OwnerOperation = z.infer<typeof ownerOperationSchema>;
/** Чтение не меняет состояние: такие операции не пишут receipt и повторяются свободно. */
export const ownerReadOperations = [
  "productPrices.list",
  "promotions.list",
  "paymentLinks.list",
  "recipients.lookup",
  "content.list",
  "activationRules.list",
  "payments.list",
  "payments.read",
  "refunds.read",
  "respondents.status",
] as const;
const readOperations: readonly string[] = ownerReadOperations;
export function isOwnerReadOperation(operation: string): boolean {
  return readOperations.includes(operation);
}

export const paymentViewSchema = z.strictObject({
  purchaseRef: idSchema,
  accountId: idSchema,
  kind: attemptKindSchema,
  state: attemptStateSchema,
  subscriptionRef: idSchema.nullable(),
  periodIndex: z.int().positive().nullable(),
  amountKopecks: moneySchema,
  environment: z.enum(["demo", "production", "local"]),
  terminalRef: z.string(),
  paymentId: z.string().nullable(),
  snapshot: priceSnapshotSchema,
  fiscalization: z.enum(["not_configured", "pending", "confirmed", "failed"]),
  confirmedAt: z.iso.datetime().nullable(),
  periodEndsAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Готовность доступа отделена от банковского состояния. */
  access: z.enum(["awaiting_payment", "preparing", "review_required", "ready"]),
  refundedKopecks: z.int().nonnegative().nullable(),
  refundableKopecks: z.int().nonnegative().nullable(),
});
export const paymentEventViewSchema = z.strictObject({
  kind: z.string(),
  occurredAt: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
});
export const refundDecisionViewSchema = z.strictObject({
  decisionRef: idSchema,
  purchaseRef: idSchema,
  accountId: idSchema,
  actorId: idSchema.nullable(),
  amountKopecks: moneySchema,
  /** Решение без основания хранит только доступ, который владелец выбрал сам. */
  basis: refundBasisSchema.nullable(),
  access: refundAccessSchema,
  recurring: z.enum(["keep", "cancel"]),
  reason: z.string(),
  state: z.enum(["decided", "executing", "executed", "failed"]),
  revision: revisionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  attempt: z
    .strictObject({
      refundRef: idSchema,
      state: z.enum(["sent", "unknown", "confirmed", "failed"]),
      amountKopecks: moneySchema,
      observedStatus: z.string().nullable(),
      errorCode: z.string().nullable(),
      updatedAt: z.iso.datetime(),
    })
    .nullable(),
});
export const auditEntryViewSchema = z.strictObject({
  actorId: idSchema,
  operationId: idSchema,
  operation: z.string().min(1).max(80),
  reason: z.string(),
  createdAt: z.iso.datetime(),
});

/**
 * Приглашение для владельца: готовая ссылка в бота. `link` — `null`, когда процессу не задан
 * адрес бота; тогда ссылку собирают из `startParameter`.
 */
export const ownerSuccessSchema = z.union([
  z.strictObject({
    outcome: z.literal("paymentLink"),
    value: paymentLinkViewSchema,
  }),
  z.strictObject({
    outcome: z.literal("paymentLinks"),
    ...paymentLinksPageSchema.shape,
  }),
  z.strictObject({
    outcome: z.literal("activationRule"),
    value: activationRuleSchema,
  }),
  z.strictObject({
    outcome: z.literal("activationRules"),
    items: z.array(activationRuleSchema),
  }),
  z.strictObject({
    outcome: z.literal("content"),
    items: z.array(coverageEntrySchema),
  }),
  z.strictObject({
    outcome: z.literal("recipient"),
    value: z.discriminatedUnion("state", [
      z.strictObject({
        state: z.literal("found"),
        recipient: z.strictObject({
          accountId: z.uuid(),
          accountRef: z.string(),
          identityRef: z.string(),
          linkRef: z.uuid(),
          linkRevision: z.int().positive(),
        }),
      }),
      z.strictObject({ state: z.literal("not_found") }),
      z.strictObject({ state: z.literal("ambiguous") }),
    ]),
  }),
  z.strictObject({
    outcome: z.literal("catalog"),
    value: catalogOutcomeSchema,
  }),
  z.strictObject({
    outcome: z.literal("catalogOffers"),
    items: z.array(priceSnapshotSchema),
    /**
     * Продукты страницы, чья цена в архиве. Архивную цену нельзя вернуть или заменить, поэтому
     * продукт больше не продаётся.
     */
    archivedProductIds: z.array(idSchema),
    nextCursor: idSchema.nullable(),
  }),
  z.strictObject({
    outcome: z.literal("promotions"),
    items: z.array(promotionListItemSchema),
    nextCursor: listCursorSchema.nullable(),
  }),
  z.strictObject({
    outcome: z.literal("payments"),
    items: z.array(paymentViewSchema),
    nextCursor: idSchema.nullable(),
  }),
  z.strictObject({
    outcome: z.literal("payment"),
    value: paymentViewSchema,
    events: z.array(paymentEventViewSchema),
    decisions: z.array(refundDecisionViewSchema),
    audit: z.array(auditEntryViewSchema),
    nextAuditCursor: paymentAuditCursorSchema.nullable(),
  }),
  z.strictObject({
    outcome: z.literal("reconciled"),
    value: paymentViewSchema,
  }),
  z.strictObject({
    outcome: z.literal("refunds"),
    purchaseRef: idSchema,
    refundedKopecks: z.int().nonnegative().nullable(),
    refundableKopecks: z.int().nonnegative().nullable(),
    decisions: z.array(refundDecisionViewSchema),
  }),
  z.strictObject({
    outcome: z.literal("respondentImport"),
    value: respondentImportSchema,
  }),
  z.strictObject({
    outcome: z.literal("respondentLink"),
    value: respondentLinkSchema,
  }),
  z.strictObject({
    outcome: z.literal("respondents"),
    value: respondentsViewSchema,
  }),
]);
export type OwnerOutcome = z.infer<typeof ownerSuccessSchema>;

export const ownerFailureCodes = [
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
  "unsupported_amount",
  "method_unavailable",
  "provider_unavailable",
  "dependency_unavailable",
] as const;
export type OwnerFailureCode = (typeof ownerFailureCodes)[number];
export const ownerResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    operationRef: idSchema,
    result: ownerSuccessSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({ code: z.enum(ownerFailureCodes) }),
  }),
]);
export type OwnerResult = z.infer<typeof ownerResultSchema>;
/** Успешный ответ транспорта: ссылка на операцию и её результат; ошибка остаётся HTTP/tool ошибкой. */
export const ownerResponseSchema = z.strictObject({
  operationRef: idSchema,
  result: ownerSuccessSchema,
});
export function ownerFailure(
  code: OwnerFailureCode,
): Extract<OwnerResult, { ok: false }> {
  return { ok: false, error: { code } };
}

/** Ошибка исходного use case переносится без потери смысла; неожидаемый код не маскируется. */
export function ownerPaymentFailure(
  code: PaymentFailureCode,
): Extract<OwnerResult, { ok: false }> {
  switch (code) {
    case "invalid_request":
    case "invalid_notification":
      return ownerFailure("invalid_request");
    case "forbidden":
      return ownerFailure("forbidden");
    case "not_found":
      return ownerFailure("not_found");
    case "operation_conflict":
      return ownerFailure("operation_conflict");
    case "revision_conflict":
      return ownerFailure("revision_conflict");
    case "payment_in_progress":
      return ownerFailure("payment_in_progress");
    case "contact_required":
    case "consent_required":
    case "existing_access":
    case "legacy_review_required":
    case "not_eligible":
    case "quote_expired":
    case "quote_changed":
      return ownerFailure("state_conflict");
    case "unsupported_amount":
      return ownerFailure("unsupported_amount");
    case "method_unavailable":
      return ownerFailure("method_unavailable");
    case "provider_unavailable":
      return ownerFailure("provider_unavailable");
    case "dependency_unavailable":
      return ownerFailure("dependency_unavailable");
    default: {
      const exhaustive: never = code;
      throw new Error(`Unknown billing failure ${String(exhaustive)}`);
    }
  }
}
/** Ошибки прав переносятся в тот же закрытый набор без потери смысла. */
export type AccessFailureCode =
  | "invalid_input"
  | "not_found"
  | "revision_conflict"
  | "operation_conflict"
  | "forbidden"
  | "unavailable"
  | "preview_expired"
  | "identity_changed"
  | "identity_conflict";
export function ownerAccessFailure(
  code: AccessFailureCode,
): Extract<OwnerResult, { ok: false }> {
  switch (code) {
    case "identity_conflict":
      return ownerFailure("identity_changed");
    case "invalid_input":
      return ownerFailure("invalid_request");
    case "unavailable":
      return ownerFailure("dependency_unavailable");
    case "not_found":
    case "revision_conflict":
    case "operation_conflict":
    case "forbidden":
    case "preview_expired":
    case "identity_changed":
      return ownerFailure(code);
    default: {
      const exhaustive: never = code;
      throw new Error(`Unknown access failure ${String(exhaustive)}`);
    }
  }
}
