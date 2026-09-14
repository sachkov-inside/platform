import { contentScopeEntrySchema } from "@inside/access-capabilities";
import { z } from "zod";
import { tierSchema, enrollmentSchema } from "@/entities/subscription";
const operationId = z.uuid();
export const listTiersSchema = z.object({ operationId, limit: z.int().min(1).max(100).default(100) });
export const readEnrollmentsInputSchema = z.object({ operationId, accountId: z.uuid() });
const terms = z.object({ startsAt: z.iso.datetime(), endsAt: z.iso.datetime().nullable(), endPolicy: z.enum(["fixed", "confirmed_external", "temporary_membership"]) });
export const assignEnrollmentInputSchema = z.object({ operationId, accountId: z.uuid(), origin: z.enum(["course", "tribute", "manual"]),
  sourceRef: z.string().min(1), tierId: z.uuid(), tierRevision: z.int().positive(), terms, billingRef: z.null(), reason: z.string().min(1),
  courseSource: z.object({ policyRef: z.string().min(1), verifiedIdentityRef: z.string().min(1) }).optional() });
export const changeEnrollmentInputSchema = z.object({ operationId, enrollmentId: z.uuid(), expectedRevision: z.int().positive(),
  action: z.enum(["change_term", "revoke", "restore"]), terms, reason: z.string().min(1) });
export const tiersOutcomeSchema = z.object({ operationRef: z.uuid(), result: z.object({ outcome: z.literal("tiers"),
  items: z.array(z.object({ tier: tierSchema, availableForAssignment: z.boolean(), published: z.boolean(), archived: z.boolean() })), nextCursor: z.uuid().nullable() }) });
export const enrollmentsOutcomeSchema = z.object({ operationRef: z.uuid(), result: z.object({ outcome: z.literal("enrollments"), items: z.array(enrollmentSchema) }) });
export const enrollmentOutcomeSchema = z.object({ operationRef: z.uuid(), result: z.object({ outcome: z.literal("enrollment"), value: enrollmentSchema }) });

export const activationRuleSchema = z.object({ id: z.uuid(), code: z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/u), name: z.string().min(1).max(200), revision: z.int().positive(), tierId: z.uuid(), tierRevision: z.int().positive(), sourceRef: z.string().min(1).max(256), published: z.boolean(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime().nullable() });
export const listRulesInputSchema = z.object({ operationId });
export const saveRuleInputSchema = z.object({ operationId, expectedRevision: z.int().positive().optional(), value: activationRuleSchema.omit({ revision: true }), reason: z.string().min(1).max(1000) });
export const rulesOutcomeSchema = z.object({ operationRef: z.uuid(), result: z.object({ outcome: z.literal("activationRules"), items: z.array(activationRuleSchema) }) });
export const ruleOutcomeSchema = z.object({ operationRef: z.uuid(), result: z.object({ outcome: z.literal("activationRule"), value: activationRuleSchema }) });
export const previewExpansionInputSchema = z.object({ operationId, tierId: z.uuid(), tierRevision: z.int().positive(), targets: z.array(z.object({ enrollmentId: z.uuid(), expectedRevision: z.int().positive(), tierRevision: z.int().positive() })).min(1).max(100), reason: z.string().min(1).max(1000) });
export const expansionPreviewSchema = z.object({ previewRef: z.uuid(), expiresAt: z.iso.datetime(), targets: previewExpansionInputSchema.shape.targets, tier: tierSchema });
export const previewExpansionOutcomeSchema = z.object({ operationRef: z.uuid(), result: z.object({ outcome: z.literal("enrollmentExpansionPreview"), value: expansionPreviewSchema }) });
export const applyExpansionInputSchema = z.object({ operationId, previewRef: z.uuid() });
export const applyExpansionOutcomeSchema = z.object({ operationRef: z.uuid(), result: z.object({ outcome: z.literal("enrollmentExpansion"), enrollmentIds: z.array(z.uuid()) }) });

export const contentCatalogOutcomeSchema = z.object({ operationRef: z.uuid(), result: z.object({ outcome: z.literal("content"), items: z.array(contentScopeEntrySchema) }) });

export const registerSourceInputSchema = z.object({ operationId, origin: z.enum(["course", "tribute"]), sourcePolicyRef: z.string().min(1).max(256), identityRef: z.string().min(1).max(256), checkedAt: z.iso.datetime(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime().nullable(), reason: z.string().min(1).max(1000) });
export const sourceOutcomeSchema = z.object({ operationRef: z.uuid(), result: z.object({ outcome: z.literal("sourceEntitlement"), value: z.object({ id: z.uuid(), origin: z.enum(["course", "tribute"]), sourceRef: z.string(), sourcePolicyRef: z.string(), identityRef: z.string(), accountId: z.uuid().nullable(), enrollmentId: z.uuid().nullable(), revision: z.int().positive(), checkedAt: z.iso.datetime() }) }) });
