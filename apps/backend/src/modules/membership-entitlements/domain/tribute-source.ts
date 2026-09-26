import { z } from "zod";
import {
  instantSchema,
  reasonSchema,
  sourceRefSchema,
} from "./access-grant.js";
import { tierSnapshotSchema } from "./subscription-enrollment.js";

const telegramUserIdSchema = z.string().regex(/^[1-9][0-9]{0,15}$/u);
export const tributePolicySchema = z.strictObject({
  id: sourceRefSchema,
  subscriptionId: z.int().positive(),
  revision: z.int().positive(),
  enabled: z.boolean(),
  tier: tierSnapshotSchema,
  temporaryUntil: instantSchema.nullable(),
});
export const saveTributePolicySchema = z.strictObject({
  operationId: z.uuid(),
  expectedRevision: z.int().nonnegative(),
  id: sourceRefSchema,
  subscriptionId: z.int().positive(),
  enabled: z.boolean(),
  tierId: z.uuid(),
  tierRevision: z.int().positive(),
  temporaryUntil: instantSchema.nullable(),
  reason: reasonSchema,
});
/** A privately verified mapping is an operator fact, never inferred from username or amount. */
export const tributeImportRowSchema = z.strictObject({
  rowRef: sourceRefSchema,
  policyRef: sourceRefSchema,
  subscriptionId: z.int().positive().nullable(),
  identityRef: sourceRefSchema.nullable(),
  telegramUserId: telegramUserIdSchema.nullable(),
  verificationRef: sourceRefSchema.nullable(),
  checkedAt: instantSchema,
  mode: z.enum(["confirmed_period", "temporary_membership"]),
  startsAt: instantSchema.nullable(),
  endsAt: instantSchema.nullable(),
  renewal: z.enum(["unknown", "enabled", "stopped"]),
  expectedRevision: z.int().nonnegative(),
  reason: reasonSchema,
});
export const previewTributeImportSchema = z.strictObject({
  operationId: z.uuid(),
  batchRef: sourceRefSchema,
  rows: z
    .array(tributeImportRowSchema)
    .min(1)
    .max(100)
    .refine(
      (rows) => new Set(rows.map((row) => row.rowRef)).size === rows.length,
    ),
});
export const applyTributeImportSchema = z.strictObject({
  operationId: z.uuid(),
  previewRef: z.uuid(),
  selectedRows: z
    .array(sourceRefSchema)
    .min(1)
    .max(100)
    .refine((rows) => new Set(rows).size === rows.length),
});
export const tributeStateSchema = z.strictObject({
  subscriptionId: z.int().positive(),
  telegramUserId: telegramUserIdSchema,
  verificationRef: sourceRefSchema,
  mode: z.enum(["confirmed_period", "temporary_membership"]),
  startsAt: instantSchema,
  endsAt: instantSchema,
  renewal: z.enum(["unknown", "enabled", "stopped"]),
  tier: tierSnapshotSchema,
  policyRevision: z.int().positive(),
  observation: z.enum([
    "pending",
    "member",
    "observation_stale",
    "source_ended",
  ]),
  observedUntil: instantSchema.nullable(),
  observationVersion: z.string().nullable(),
  lastEventAt: z.string().nullable(),
  lastEventFingerprint: z.string().nullable(),
});
export const tributeSourceViewSchema = z.strictObject({
  id: z.uuid(),
  sourceRef: sourceRefSchema,
  policyRef: sourceRefSchema,
  identityRef: sourceRefSchema,
  revision: z.int().positive(),
  accountId: z.uuid().nullable(),
  enrollmentId: z.uuid().nullable(),
  revoked: z.boolean(),
  checkedAt: instantSchema,
  state: tributeStateSchema,
  status: z.enum([
    "pending_identity",
    "active",
    "scheduled",
    "expired",
    "revoked",
    "pending_verification",
    "suspended_source",
  ]),
});
export const tributePreviewRowSchema = z.strictObject({
  rowRef: sourceRefSchema,
  status: z.enum([
    "new",
    "matched",
    "pending_identity",
    "ambiguous",
    "unknown_term",
    "conflict",
  ]),
  detail: z.string(),
  sourceId: z.uuid().nullable(),
  accountId: z.uuid().nullable(),
  sourceRevision: z.int().nonnegative(),
  policyRevision: z.int().nonnegative(),
  enrollmentRevision: z.int().nonnegative(),
  bindingFingerprint: z.string().length(64).nullable(),
  shortens: z.boolean(),
  tier: tierSnapshotSchema.nullable(),
  startsAt: instantSchema.nullable(),
  endsAt: instantSchema.nullable(),
});
export const tributePreviewSchema = z.strictObject({
  previewRef: z.uuid(),
  batchRef: sourceRefSchema,
  expiresAt: instantSchema,
  rows: z.array(tributePreviewRowSchema),
});
export const tributeApplyResultSchema = z.strictObject({
  previewRef: z.uuid(),
  sources: z.array(tributeSourceViewSchema),
});
export const tributeInboxViewSchema = z.strictObject({
  id: z.uuid(),
  state: z.enum(["received", "applied", "pending_reconciliation", "rejected"]),
  reason: z.string(),
  sourceId: z.uuid().nullable(),
  revision: z.int().positive(),
  receivedAt: instantSchema,
  updatedAt: instantSchema,
});
export const reconcileTributeSchema = z
  .strictObject({
    operationId: z.uuid(),
    sourceId: z.uuid(),
    expectedRevision: z.int().positive(),
    action: z.enum(["retry", "revoke", "restore"]),
    reason: reasonSchema,
    confirmedTerms: z
      .strictObject({
        startsAt: instantSchema,
        endsAt: instantSchema,
        verificationRef: sourceRefSchema,
      })
      .optional(),
  })
  .refine(
    (value) =>
      value.action !== "restore" ||
      (value.confirmedTerms !== undefined &&
        value.confirmedTerms.endsAt > value.confirmedTerms.startsAt),
  );
export const retryTributeInboxSchema = z.strictObject({
  operationId: z.uuid(),
  inboxId: z.uuid(),
  expectedRevision: z.int().positive(),
  action: z.enum(["retry", "reject"]).optional(),
  reason: reasonSchema,
});
export const tributeImportReviewSchema = z.strictObject({
  previewRef: z.uuid(),
  batchRef: sourceRefSchema,
  revision: z.int().positive(),
  state: z.enum(["pending", "applied", "dismissed"]),
  pendingRows: z.array(sourceRefSchema),
  expiresAt: instantSchema,
  reason: z.string(),
});
export const dismissTributeImportSchema = z.strictObject({
  operationId: z.uuid(),
  previewRef: z.uuid(),
  expectedRevision: z.int().positive(),
  reason: reasonSchema,
});
export const tributeOperationsViewSchema = z.strictObject({
  page: z.int().nonnegative(),
  hasMore: z.boolean(),
  imports: z.array(tributeImportReviewSchema),
  policies: z.array(tributePolicySchema),
  unconfirmedSources: z.array(
    z.strictObject({
      id: z.uuid(),
      sourceRef: sourceRefSchema,
      policyRef: sourceRefSchema,
      identityRef: sourceRefSchema,
      revision: z.int().positive(),
    }),
  ),
  sources: z.array(tributeSourceViewSchema),
  inbox: z.array(tributeInboxViewSchema),
  metrics: z.strictObject({
    unresolvedImports: z.int().nonnegative(),
    pendingIdentity: z.int().nonnegative(),
    unresolvedEvents: z.int().nonnegative(),
    temporarySources: z.int().nonnegative(),
    staleConfirmations: z.int().nonnegative(),
    rolloutBlocked: z.boolean(),
  }),
});
export type TributeState = z.infer<typeof tributeStateSchema>;
export type TributeImportRow = z.infer<typeof tributeImportRowSchema>;
