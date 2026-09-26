import { isGuideCapability } from "@inside/access-capabilities";
import { contentScopeEntrySchema } from "@inside/access-capabilities";
import { z } from "zod";
import { contentScopeSchema } from "@inside/access-capabilities";
import {
  capabilitiesSchema,
  instantSchema,
  reasonSchema,
  sourceRefSchema,
} from "./access-grant.js";

export const tierSnapshotSchema = z.strictObject({
  id: z.uuid(),
  revision: z.int().positive(),
  name: z.string().trim().min(1).max(200),
  benefits: capabilitiesSchema.refine(
    (values) => !values.some((value) => isGuideCapability(value)),
  ),
  contentScope: contentScopeSchema,
});
export type TierSnapshot = z.infer<typeof tierSnapshotSchema>;
export const enrollmentOriginSchema = z.enum([
  "course",
  "tribute",
  "manual",
  "platform_payment",
]);
export const enrollmentTermsSchema = z
  .strictObject({
    startsAt: instantSchema,
    endsAt: instantSchema.nullable(),
    endPolicy: z.enum(["fixed", "confirmed_external", "temporary_membership"]),
  })
  .refine((value) => value.endsAt === null || value.endsAt > value.startsAt);
export const assignEnrollmentSchema = z
  .strictObject({
    operationId: z.uuid(),
    accountId: z.uuid(),
    origin: enrollmentOriginSchema,
    sourceRef: sourceRefSchema,
    courseSource: z
      .strictObject({
        policyRef: sourceRefSchema,
        verifiedIdentityRef: sourceRefSchema,
      })
      .optional(),
    tierId: z.uuid(),
    tierRevision: z.int().positive(),
    terms: enrollmentTermsSchema,
    billingRef: z.uuid().nullable(),
    reason: reasonSchema,
  })
  .refine(
    (value) =>
      (value.origin === "platform_payment") === (value.billingRef !== null),
  )
  .refine(
    (value) =>
      value.origin !== "course" ||
      (value.terms.endsAt === null && value.terms.endPolicy === "fixed"),
  )
  .refine(
    (value) =>
      value.origin !== "tribute" ||
      (value.terms.endsAt !== null && value.terms.endPolicy !== "fixed"),
  );
export const changeEnrollmentSchema = z.strictObject({
  operationId: z.uuid(),
  enrollmentId: z.uuid(),
  expectedRevision: z.int().positive(),
  action: z.enum(["change_term", "revoke", "restore"]),
  terms: enrollmentTermsSchema,
  reason: reasonSchema,
});
export const enrollmentViewSchema = z.strictObject({
  id: z.uuid(),
  accountId: z.uuid(),
  tier: tierSnapshotSchema,
  origin: enrollmentOriginSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
  endPolicy: enrollmentTermsSchema.shape.endPolicy,
  revision: z.int().positive(),
  state: z.enum([
    "scheduled",
    "active",
    "expired",
    "revoked",
    "pending_verification",
    "suspended_source",
  ]),
  nextChargeAt: z.iso.datetime().nullable().optional(),
  renewal: z.enum(["not_applicable", "billing_agreement"]),
  benefitTerms: z
    .array(
      z.strictObject({
        capability: z.string(),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime().nullable(),
        revoked: z.boolean(),
      }),
    )
    .optional(),
  content: z.array(contentScopeEntrySchema).optional(),
  history: z
    .array(
      z.strictObject({
        kind: z.string(),
        reason: z.string(),
        recordedAt: z.iso.datetime(),
      }),
    )
    .optional(),
});
export const enrollmentResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), value: enrollmentViewSchema }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      code: z.enum([
        "invalid_input",
        "not_found",
        "revision_conflict",
        "operation_conflict",
        "identity_conflict",
        "forbidden",
        "unavailable",
      ]),
    }),
  }),
]);
export type EnrollmentResult = z.infer<typeof enrollmentResultSchema>;

export const previewEnrollmentExpansionSchema = z.strictObject({
  operationId: z.uuid(),
  tierId: z.uuid(),
  tierRevision: z.int().positive(),
  targets: z
    .array(
      z.strictObject({
        enrollmentId: z.uuid(),
        expectedRevision: z.int().positive(),
        tierRevision: z.int().positive(),
      }),
    )
    .min(1)
    .max(100)
    .refine(
      (rows) =>
        new Set(rows.map((row) => row.enrollmentId)).size === rows.length,
    ),
  reason: reasonSchema,
});
export const applyEnrollmentExpansionSchema = z.strictObject({
  operationId: z.uuid(),
  previewRef: z.uuid(),
});
export const expansionPreviewSchema = z.strictObject({
  previewRef: z.uuid(),
  expiresAt: z.iso.datetime(),
  targets: previewEnrollmentExpansionSchema.shape.targets,
  tier: tierSnapshotSchema,
});
