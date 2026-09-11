import { z } from "zod";

import {
  accessCapabilitySchema,
  attemptStateSchema,
  priceSnapshotSchema,
  subscriptionViewSchema,
} from "@/entities/subscription";

const operationId = z.uuid();
const revision = z.number().int().positive();
const reason = z.string().trim().min(1).max(1000);
const money = z.number().int().positive();
const instant = z.iso.datetime({ offset: true });

export const saveOfferInputSchema = z.strictObject({
  operationId,
  expectedRevision: revision.optional(),
  value: z.strictObject({
    id: z.uuid(),
    name: z.string().trim().min(1).max(200),
    benefits: z.array(accessCapabilitySchema).min(1).max(100),
    benefitPeriods: z
      .array(
        z.strictObject({
          capability: accessCapabilitySchema,
          months: z.number().int().positive().max(1200).nullable(),
        }),
      )
      .max(100)
      .optional(),
  }),
});
export const savePaymentOptionInputSchema = z.strictObject({
  operationId,
  expectedRevision: revision.optional(),
  value: z.strictObject({
    id: z.uuid(),
    offerId: z.uuid(),
    mode: z.literal("subscription").optional(),
    months: z.number().int().positive().max(1200),
    priceKopecks: money,
  }),
});
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
    offerIds: z.array(z.uuid()).max(100),
    paymentOptionIds: z.array(z.uuid()).max(100),
    usageLimit: revision.nullable(),
  }),
});
export const archiveInputSchema = z.strictObject({
  operationId,
  expectedRevision: revision,
  id: z.uuid(),
});
export const listPaymentsInputSchema = z.strictObject({
  operationId,
  accountId: z.uuid().optional(),
  state: attemptStateSchema.optional(),
  kind: z.enum(["initial", "renewal", "upgrade"]).optional(),
  cursor: z.uuid().optional(),
  limit: z.number().int().min(1).max(100),
});
export const purchaseInputSchema = z.strictObject({
  operationId,
  purchaseRef: z.uuid(),
});
export const cancelSubscriptionInputSchema = z.strictObject({
  operationId,
  accountId: z.uuid(),
  expectedRevision: revision,
  reason,
});
export const decideRefundInputSchema = z.strictObject({
  operationId,
  purchaseRef: z.uuid(),
  amountKopecks: money,
  access: z.enum(["keep", "revoke"]),
  recurring: z.enum(["keep", "cancel"]),
  reason,
});
export const executeRefundInputSchema = z.strictObject({
  operationId,
  decisionRef: z.uuid(),
  expectedRevision: revision,
});
export const readGrantsInputSchema = z.strictObject({
  operationId,
  accountId: z.uuid(),
});
export const grantRowSchema = z.strictObject({
  rowKey: z.string().min(1).max(100),
  accountId: z.uuid(),
  source: z.enum(["manual", "legacy"]),
  sourceRef: z.string().min(1).max(256),
  terms: z.strictObject({
    capabilities: z.array(accessCapabilitySchema).min(1).max(100),
    startsAt: instant,
    validUntil: instant.nullable(),
    reason,
  }),
});
export const previewBatchInputSchema = z.strictObject({
  operationId,
  rows: z.array(grantRowSchema).min(1).max(100),
});
export const applyBatchInputSchema = z.strictObject({
  operationId,
  previewRef: z.uuid(),
  expectedRevision: revision,
  confirmedRows: z.array(z.string().min(1).max(100)).min(1).max(100),
});
export const extendGrantInputSchema = z.strictObject({
  operationId,
  grantRef: z.uuid(),
  expectedRevision: revision,
  reason,
  validUntil: instant.nullable(),
});
export const revokeGrantInputSchema = z.strictObject({
  operationId,
  grantRef: z.uuid(),
  expectedRevision: revision,
  reason,
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
  kind: z.enum(["initial", "renewal", "upgrade"]),
  state: attemptStateSchema,
  subscriptionRef: z.uuid().nullable(),
  periodIndex: z.number().int().positive().nullable(),
  amountKopecks: money,
  environment: z.enum(["demo", "production"]),
  terminalRef: z.string(),
  paymentId: z.string().nullable(),
  snapshot: priceSnapshotSchema,
  fiscalization: z.enum(["not_configured", "pending", "confirmed", "failed"]),
  confirmedAt: z.iso.datetime().nullable(),
  periodEndsAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  access: z.enum(["awaiting_payment", "preparing", "ready"]),
  refundedKopecks: z.number().int().nonnegative(),
  refundableKopecks: z.number().int().nonnegative(),
});
export const refundDecisionViewSchema = z.object({
  decisionRef: z.uuid(),
  purchaseRef: z.uuid(),
  accountId: z.uuid(),
  actorId: z.uuid(),
  amountKopecks: money,
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
export const accessGrantViewSchema = z.object({
  grantRef: z.uuid(),
  accountId: z.uuid(),
  source: z.enum(["paid", "manual", "legacy"]),
  sourceRef: z.string(),
  capabilities: z.array(accessCapabilitySchema),
  startsAt: z.iso.datetime(),
  validUntil: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  revision,
  reason: z.string(),
  active: z.boolean(),
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
export const subscriptionOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("subscription"),
    value: subscriptionViewSchema,
  }),
);
export const refundDecisionOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("refundDecision"),
    value: refundDecisionViewSchema,
  }),
);
export const refundsOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("refunds"),
    purchaseRef: z.uuid(),
    refundedKopecks: z.number().int().nonnegative(),
    refundableKopecks: z.number().int().nonnegative(),
    decisions: z.array(refundDecisionViewSchema),
  }),
);
export const grantsOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("grants"),
    value: z.object({
      accountId: z.uuid(),
      grants: z.array(accessGrantViewSchema),
      history: z.array(
        z.object({
          revision,
          grantRef: z.uuid().nullable(),
          actorId: z.uuid().nullable(),
          operationId: z.uuid(),
          kind: z.string(),
          reason: z.string(),
          recordedAt: z.iso.datetime(),
        }),
      ),
    }),
  }),
);
export const grantPreviewOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("grantPreview"),
    previewRef: z.uuid(),
    revision,
    expiresAt: z.iso.datetime(),
    rows: z.array(
      z.object({
        rowKey: z.string(),
        accountId: z.uuid(),
        status: z.enum(["confirmed", "not_found"]),
      }),
    ),
  }),
);
export const grantBatchOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("grantBatch"),
    rows: z.array(
      z.object({
        rowKey: z.string(),
        result: z.union([
          z.object({ ok: z.literal(true), grantRef: z.uuid(), revision }),
          z.object({
            ok: z.literal(false),
            error: z.object({ code: z.literal("operation_conflict") }),
          }),
        ]),
      }),
    ),
  }),
);
export const grantOutcomeSchema = envelope(
  z.object({ outcome: z.literal("grant"), grantRef: z.uuid(), revision }),
);

export type SaveOfferInput = z.infer<typeof saveOfferInputSchema>;
export type SavePaymentOptionInput = z.infer<typeof savePaymentOptionInputSchema>;
export type SavePromotionInput = z.infer<typeof savePromotionInputSchema>;
export type ArchiveInput = z.infer<typeof archiveInputSchema>;
export type ListPaymentsInput = z.infer<typeof listPaymentsInputSchema>;
export type PurchaseCommandInput = z.infer<typeof purchaseInputSchema>;
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionInputSchema>;
export type DecideRefundInput = z.infer<typeof decideRefundInputSchema>;
export type ExecuteRefundInput = z.infer<typeof executeRefundInputSchema>;
export type ReadGrantsInput = z.infer<typeof readGrantsInputSchema>;
export type GrantRow = z.infer<typeof grantRowSchema>;
export type PreviewBatchInput = z.infer<typeof previewBatchInputSchema>;
export type ApplyBatchInput = z.infer<typeof applyBatchInputSchema>;
export type ExtendGrantInput = z.infer<typeof extendGrantInputSchema>;
export type RevokeGrantInput = z.infer<typeof revokeGrantInputSchema>;
export type CatalogOutcome = z.infer<typeof catalogOutcomeSchema>;
export type PaymentView = z.infer<typeof paymentViewSchema>;
export type PaymentsOutcome = z.infer<typeof paymentsOutcomeSchema>;
export type PaymentOutcome = z.infer<typeof paymentOutcomeSchema>;
export type ReconciledOutcome = z.infer<typeof reconciledOutcomeSchema>;
export type SubscriptionOutcome = z.infer<typeof subscriptionOutcomeSchema>;
export type RefundDecisionOutcome = z.infer<typeof refundDecisionOutcomeSchema>;
export type RefundsOutcome = z.infer<typeof refundsOutcomeSchema>;
export type GrantsOutcome = z.infer<typeof grantsOutcomeSchema>;
export type GrantPreviewOutcome = z.infer<typeof grantPreviewOutcomeSchema>;
export type GrantBatchOutcome = z.infer<typeof grantBatchOutcomeSchema>;
export type GrantOutcome = z.infer<typeof grantOutcomeSchema>;
export type AccessGrantView = z.infer<typeof accessGrantViewSchema>;
export type RefundDecisionView = z.infer<typeof refundDecisionViewSchema>;
