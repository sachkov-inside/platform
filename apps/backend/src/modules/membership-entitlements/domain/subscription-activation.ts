import { z } from "zod";
import { instantSchema, reasonSchema, sourceRefSchema } from "./access-grant.js";
import { enrollmentViewSchema } from "./subscription-enrollment.js";
export const ACTIVATION_CONTRACT_VERSION = "inside.subscription-activation.v1" as const;
export const bindingLookupQuerySchema = z.strictObject({
  contractVersion: z.literal(ACTIVATION_CONTRACT_VERSION), identityRef: sourceRefSchema,
});
export const bindingSnapshotSchema = z.strictObject({
  accountRef: sourceRefSchema, identityRef: sourceRefSchema,
  linkRef: z.uuid(), linkRevision: z.int().positive(),
});
export const activationCodeSchema = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/u);
const verificationModeSchema = z.enum(["course_membership", "tribute_registry"]);
export const activationRuleSchema = z.strictObject({
  id: z.uuid(), code: activationCodeSchema, name: z.string().trim().min(1).max(200), revision: z.int().positive(),
  tierId: z.uuid(), tierRevision: z.int().positive(), sourceRef: sourceRefSchema, verificationMode: verificationModeSchema.optional(), published: z.boolean(),
  startsAt: instantSchema, endsAt: instantSchema.nullable(),
});
export const manageActivationRuleSchema = z.strictObject({
  operationId: z.uuid(), expectedRevision: z.int().positive().optional(),
  value: activationRuleSchema.omit({ revision: true }), reason: reasonSchema,
}).refine(value => value.value.endsAt === null || value.value.endsAt > value.value.startsAt);
export const beginActivationSchema = z.strictObject({
  contractVersion: z.literal(ACTIVATION_CONTRACT_VERSION), attemptId: z.uuid(), code: activationCodeSchema,
  identityRef: sourceRefSchema,
});
export const activationEvidenceSchema = z.strictObject({
  contractVersion: z.literal(ACTIVATION_CONTRACT_VERSION), audience: z.literal("inside.platform.subscription-activation"),
  evidenceRef: z.uuid(), attemptId: z.uuid(), sourceRef: sourceRefSchema, identityRef: sourceRefSchema,
  accountRef: sourceRefSchema, linkRef: z.uuid(), linkRevision: z.int().positive(),
  ruleId: z.uuid(), ruleRevision: z.int().positive(),
  checkedAt: instantSchema, validUntil: instantSchema,
  decision: z.enum(["member", "not_member", "unavailable", "registry_lookup"]),
});
export const activationOutcomeSchema = z.strictObject({
  contractVersion: z.literal(ACTIVATION_CONTRACT_VERSION), attemptId: z.uuid(),
  state: z.enum(["needs_account", "checking", "pending_review", "active", "already_active", "unavailable", "rejected"]),
  enrollment: enrollmentViewSchema.nullable(),
  rule: z.strictObject({ id: z.uuid(), revision: z.int().positive(), sourceRef: sourceRefSchema, verificationMode: verificationModeSchema.optional() }).optional(),
});
export type ActivationOutcome = z.infer<typeof activationOutcomeSchema>;
export interface ActivationBindings {
  find(query: { accountRef: string }): Promise<{ ok: true; link: { accountId: string; accountRef: string; telegramIdentityRef: string } | null } | { ok: false }>;
  readBinding(query: { accountId: string }): Promise<{ ok: true; binding: { accountRef: string | null; telegramIdentityRef: string | null; linkRef: string; linkRevision: number } | null } | { ok: false }>;
}

export const registerSourceSchema = z.strictObject({ operationId: z.uuid(), origin: z.enum(["course", "tribute"]),
  sourcePolicyRef: sourceRefSchema, identityRef: sourceRefSchema, checkedAt: instantSchema,
  startsAt: instantSchema, endsAt: instantSchema.nullable(), reason: reasonSchema,
}).refine(value => value.origin === "course" ? value.endsAt === null : value.endsAt !== null && value.endsAt > value.startsAt);
export const sourceEntitlementViewSchema = z.strictObject({ id: z.uuid(), origin: z.enum(["course", "tribute"]), sourceRef: sourceRefSchema,
  sourcePolicyRef: sourceRefSchema, identityRef: sourceRefSchema, accountId: z.uuid().nullable(), enrollmentId: z.uuid().nullable(), revision: z.int().positive(), checkedAt: z.iso.datetime() });

export const ownSubscriptionAccessQuerySchema = z.strictObject({ contractVersion: z.literal(ACTIVATION_CONTRACT_VERSION),
 accountRef: sourceRefSchema, identityRef: sourceRefSchema, linkRef: z.uuid(), linkRevision: z.int().positive() });
