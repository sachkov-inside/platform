import {
  dismissTributeImportSchema,
  tributeImportReviewSchema,
  saveTributePolicySchema,
  previewTributeImportSchema,
  applyTributeImportSchema,
  reconcileTributeSchema,
  retryTributeInboxSchema,
  tributePolicySchema,
  tributePreviewSchema,
  tributeApplyResultSchema,
  tributeSourceViewSchema,
  tributeInboxViewSchema,
  tributeOperationsViewSchema,
} from "../../account-rights/index.js";
import { coverageEntrySchema } from "@inside/access-capabilities";
import { z } from "zod";
import {
  registerSourceSchema,
  sourceEntitlementViewSchema,
  manageActivationRuleSchema,
  activationRuleSchema,
  previewEnrollmentExpansionSchema,
  applyEnrollmentExpansionSchema,
  expansionPreviewSchema,
  assignEnrollmentSchema,
  changeEnrollmentSchema,
  enrollmentViewSchema,
  tierSnapshotSchema,
  applyGrantBatchCommandSchema,
  changeAccessGrantCommandSchema,
  previewGrantBatchCommandSchema,
  grantPreviewRowSchema,
  accessGrantsViewSchema,
  classifyLegacyAccountCommandSchema,
  legacyClassificationViewSchema,
  invitationViewSchema,
  issueInvitationSchema,
  listInvitationsSchema,
  revokeInvitationSchema,
  accessHolderSchema,
  accessSourceSchema,
  invitationFunnelSchema,
  listAccessHoldersSchema,
} from "../../account-rights/index.js";
import {
  manageCatalogSchema,
  catalogOutcomeSchema,
} from "../features/manage-catalog/manage-catalog.contract.js";
import {
  benefitPeriodsSchema,
  idSchema,
  moneySchema,
  priceSnapshotSchema,
  revisionSchema,
} from "./pricing.js";
import { attemptKindSchema, attemptStateSchema } from "./payment-attempt.js";
import {
  importRespondentsSchema,
  issueRespondentLinkSchema,
  respondentImportSchema,
  respondentLinkSchema,
  respondentsViewSchema,
} from "../features/survey-respondents/survey-respondents.contract.js";
import { subscriptionViewSchema } from "./subscription-change.js";
import type { PaymentFailureCode } from "../features/purchase-subscription/purchase-subscription.contract.js";

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
export function refundAccessFor(basis: RefundBasis): RefundAccess {
  return basis === "withdrawal" ? "revoke" : "keep";
}

/**
 * Владельческие операции billing: один закрытый набор для admin API и MCP. Каталог сохраняет
 * прежние схемы, платежи и возвраты добавляют собственные. Actor приходит из adapter, не из payload.
 */
export const ownerOperationSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    ...command,
    operation: z.literal("tribute.status"),
    page: z.int().min(0).max(100000).optional(),
  }),
  z.strictObject({
    ...dismissTributeImportSchema.shape,
    operation: z.literal("tribute.dismissImport"),
  }),
  z.strictObject({
    ...saveTributePolicySchema.shape,
    operation: z.literal("tribute.savePolicy"),
  }),
  z.strictObject({
    ...previewTributeImportSchema.shape,
    operation: z.literal("tribute.preview"),
  }),
  z.strictObject({
    ...applyTributeImportSchema.shape,
    operation: z.literal("tribute.apply"),
  }),
  z.strictObject({
    ...reconcileTributeSchema.shape,
    operation: z.literal("tribute.reconcile"),
  }),
  z.strictObject({
    ...retryTributeInboxSchema.shape,
    operation: z.literal("tribute.retryEvent"),
  }),
  z.strictObject({
    ...command,
    operation: z.literal("recipients.lookup"),
    identityRef: z.string().trim().min(1).max(256),
  }),
  ...manageCatalogSchema.options,
  z.strictObject({ ...command, operation: z.literal("content.list") }),
  z.strictObject({
    ...registerSourceSchema.shape,
    operation: z.literal("sources.register"),
  }),
  z.strictObject({
    ...manageActivationRuleSchema.shape,
    operation: z.literal("activationRules.save"),
  }),
  z.strictObject({ ...command, operation: z.literal("activationRules.list") }),
  z.strictObject({
    ...previewEnrollmentExpansionSchema.shape,
    operation: z.literal("enrollments.previewExpansion"),
  }),
  z.strictObject({
    ...applyEnrollmentExpansionSchema.shape,
    operation: z.literal("enrollments.applyExpansion"),
  }),
  z.strictObject({
    ...assignEnrollmentSchema.shape,
    operation: z.literal("enrollments.assign"),
  }),
  z.strictObject({
    ...changeEnrollmentSchema.shape,
    operation: z.literal("enrollments.change"),
  }),
  z.strictObject({
    ...command,
    operation: z.literal("enrollments.list"),
    accountId: idSchema,
  }),
  z.strictObject({
    ...command,
    operation: z.literal("tiers.list"),
    ...listBounds,
  }),
  z.strictObject({
    ...command,
    operation: z.literal("offers.list"),
    ...listBounds,
  }),
  z.strictObject({
    ...command,
    operation: z.literal("payments.list"),
    accountId: idSchema.optional(),
    state: attemptStateSchema.optional(),
    kind: attemptKindSchema.optional(),
    ...listBounds,
  }),
  z.strictObject({
    ...command,
    operation: z.literal("payments.read"),
    purchaseRef: idSchema,
  }),
  z.strictObject({
    ...command,
    operation: z.literal("payments.reconcile"),
    purchaseRef: idSchema,
  }),
  z.strictObject({
    ...command,
    operation: z.literal("subscriptions.cancel"),
    accountId: idSchema,
    expectedRevision: revisionSchema,
    reason: reasonSchema,
  }),
  z.strictObject({
    ...command,
    operation: z.literal("refunds.decide"),
    purchaseRef: idSchema,
    amountKopecks: moneySchema,
    basis: refundBasisSchema,
    recurring: z.enum(["keep", "cancel"]),
    reason: reasonSchema,
  }),
  z.strictObject({
    ...command,
    operation: z.literal("refunds.execute"),
    decisionRef: idSchema,
    expectedRevision: revisionSchema,
  }),
  z.strictObject({
    ...command,
    operation: z.literal("refunds.read"),
    purchaseRef: idSchema,
  }),
  z.strictObject({
    ...command,
    operation: z.literal("grants.read"),
    accountId: idSchema,
  }),
  z.strictObject({
    ...command,
    operation: z.literal("grants.readClassification"),
    accountId: idSchema,
  }),
  // Кросс-полевые правила команды и её строк остаются за владеющим use case: он повторно разбирает команду.
  z.strictObject({
    ...classifyLegacyAccountCommandSchema.shape,
    operation: z.literal("grants.classify"),
  }),
  z.strictObject({
    ...previewGrantBatchCommandSchema.shape,
    operation: z.literal("grants.previewBatch"),
  }),
  z.strictObject({
    ...applyGrantBatchCommandSchema.shape,
    operation: z.literal("grants.applyBatch"),
  }),
  z.strictObject({
    ...changeAccessGrantCommandSchema.options[0].omit({ action: true }).shape,
    operation: z.literal("grants.extend"),
  }),
  z.strictObject({
    ...changeAccessGrantCommandSchema.options[1].omit({ action: true }).shape,
    operation: z.literal("grants.revoke"),
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
  z.strictObject({
    ...issueInvitationSchema.shape,
    operation: z.literal("invitations.issue"),
  }),
  z.strictObject({
    ...revokeInvitationSchema.shape,
    operation: z.literal("invitations.revoke"),
  }),
  z.strictObject({
    ...listInvitationsSchema.shape,
    operation: z.literal("invitations.list"),
  }),
  z.strictObject({
    ...listAccessHoldersSchema.shape,
    operation: z.literal("people.list"),
  }),
  z.strictObject({ ...command, operation: z.literal("access.summary") }),
]);
export type OwnerOperation = z.infer<typeof ownerOperationSchema>;
/** Чтение не меняет состояние: такие операции не пишут receipt и повторяются свободно. */
export const ownerReadOperations = [
  "tribute.status",
  "recipients.lookup",
  "content.list",
  "activationRules.list",
  "enrollments.list",
  "tiers.list",
  "offers.list",
  "payments.list",
  "payments.read",
  "refunds.read",
  "grants.read",
  "grants.readClassification",
  "respondents.status",
  "invitations.list",
  "people.list",
  "access.summary",
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
  access: z.enum(["awaiting_payment", "preparing", "ready"]),
  refundedKopecks: z.int().nonnegative(),
  refundableKopecks: z.int().nonnegative(),
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
  actorId: idSchema,
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
export const ownerInvitationSchema = invitationViewSchema.extend({
  link: z.url().nullable(),
});
/**
 * Сводка раздела «Доступ» на момент `asOf`. `active` — люди с действующим основанием по Offer:
 * платные (оплата, Tribute, разовая покупка), подарочные (приглашение, решение владельца) и курс;
 * человек с двумя основаниями одной группы считается один раз. `attention` — основания, которые
 * кончаются за 7 дней, и сбои списания за 7 дней. `revenue` — подтверждённые оплаты и возвраты
 * по месяцам Москвы и Offer за 12 месяцев.
 */
export const accessSummarySchema = z.strictObject({
  asOf: z.iso.datetime(),
  active: z.array(
    z.strictObject({
      offerId: idSchema,
      name: z.string(),
      paid: z.int().nonnegative(),
      gift: z.int().nonnegative(),
      course: z.int().nonnegative(),
    }),
  ),
  invitations: invitationFunnelSchema,
  attention: z.array(
    z.strictObject({
      accountId: idSchema,
      reason: z.enum(["ending", "payment_failed"]),
      source: accessSourceSchema.nullable(),
      offerId: idSchema.nullable(),
      title: z.string(),
      at: z.iso.datetime(),
    }),
  ),
  revenue: z.array(
    z.strictObject({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      offerId: idSchema,
      name: z.string(),
      payments: z.int().nonnegative(),
      revenueKopecks: z.int().nonnegative(),
      refunds: z.int().nonnegative(),
      refundedKopecks: z.int().nonnegative(),
    }),
  ),
});
export type AccessSummary = z.infer<typeof accessSummarySchema>;
export const ownerSuccessSchema = z.union([
  z.strictObject({
    outcome: z.literal("tributeImportReview"),
    value: tributeImportReviewSchema,
  }),
  z.strictObject({
    outcome: z.literal("tributeStatus"),
    value: tributeOperationsViewSchema,
  }),
  z.strictObject({
    outcome: z.literal("tributePolicy"),
    value: tributePolicySchema,
  }),
  z.strictObject({
    outcome: z.literal("tributePreview"),
    value: tributePreviewSchema,
  }),
  z.strictObject({
    outcome: z.literal("tributeApplied"),
    value: tributeApplyResultSchema,
  }),
  z.strictObject({
    outcome: z.literal("tributeSource"),
    value: tributeSourceViewSchema,
  }),
  z.strictObject({
    outcome: z.literal("tributeEvent"),
    value: tributeInboxViewSchema,
  }),
  z.strictObject({
    outcome: z.literal("sourceEntitlement"),
    value: sourceEntitlementViewSchema,
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
    outcome: z.literal("enrollmentExpansionPreview"),
    value: expansionPreviewSchema,
  }),
  z.strictObject({
    outcome: z.literal("enrollmentExpansion"),
    enrollmentIds: z.array(idSchema),
  }),
  z.strictObject({
    outcome: z.literal("enrollment"),
    value: enrollmentViewSchema,
  }),
  z.strictObject({
    outcome: z.literal("enrollments"),
    items: z.array(enrollmentViewSchema),
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
    outcome: z.literal("tiers"),
    items: z.array(
      z.strictObject({
        tier: tierSnapshotSchema,
        benefitPeriods: benefitPeriodsSchema,
        availableForAssignment: z.boolean(),
        published: z.boolean(),
        archived: z.boolean(),
      }),
    ),
    nextCursor: idSchema.nullable(),
  }),
  z.strictObject({
    outcome: z.literal("catalog"),
    value: catalogOutcomeSchema,
  }),
  z.strictObject({
    outcome: z.literal("catalogOffers"),
    items: z.array(priceSnapshotSchema),
    nextCursor: idSchema.nullable(),
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
  }),
  z.strictObject({
    outcome: z.literal("reconciled"),
    value: paymentViewSchema,
  }),
  z.strictObject({
    outcome: z.literal("subscription"),
    value: subscriptionViewSchema,
  }),
  z.strictObject({
    outcome: z.literal("refundDecision"),
    value: refundDecisionViewSchema,
  }),
  z.strictObject({
    outcome: z.literal("refunds"),
    purchaseRef: idSchema,
    refundedKopecks: z.int().nonnegative(),
    refundableKopecks: z.int().nonnegative(),
    decisions: z.array(refundDecisionViewSchema),
  }),
  z.strictObject({
    outcome: z.literal("grants"),
    value: accessGrantsViewSchema,
  }),
  z.strictObject({
    outcome: z.literal("classification"),
    value: legacyClassificationViewSchema,
  }),
  z.strictObject({
    outcome: z.literal("grantPreview"),
    previewRef: idSchema,
    revision: revisionSchema,
    expiresAt: z.iso.datetime(),
    rows: z.array(grantPreviewRowSchema),
  }),
  z.strictObject({
    outcome: z.literal("grantBatch"),
    rows: z.array(
      z.strictObject({
        rowKey: z.string(),
        result: z.union([
          z.strictObject({
            ok: z.literal(true),
            grantRef: idSchema,
            revision: revisionSchema,
          }),
          z.strictObject({
            ok: z.literal(true),
            classification: legacyClassificationViewSchema.shape.classification,
            revision: revisionSchema,
          }),
          z.strictObject({
            ok: z.literal(false),
            error: z.strictObject({ code: z.literal("operation_conflict") }),
          }),
        ]),
      }),
    ),
  }),
  z.strictObject({
    outcome: z.literal("grant"),
    grantRef: idSchema,
    revision: revisionSchema,
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
  // Заметки владельца о человеке в итоге выдачи и отзыва нет. Код и ссылка погашают неоткрытое
  // приглашение, поэтому журнал хранит итог без них (`auditedOutcome`), а повтор выдачи читает их
  // заново.
  z.strictObject({
    outcome: z.literal("invitation"),
    value: ownerInvitationSchema
      .omit({ note: true })
      .partial({ code: true, startParameter: true, link: true }),
  }),
  z.strictObject({
    outcome: z.literal("invitations"),
    items: z.array(ownerInvitationSchema),
    nextCursor: idSchema.nullable(),
  }),
  z.strictObject({
    outcome: z.literal("people"),
    items: z.array(accessHolderSchema),
    nextCursor: idSchema.nullable(),
  }),
  z.strictObject({
    outcome: z.literal("accessSummary"),
    value: accessSummarySchema,
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
