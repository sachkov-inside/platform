import { coverageEntrySchema } from "@inside/access-capabilities";
import { z } from "zod";
const operationId = z.uuid();
export const activationRuleSchema = z.object({
  id: z.uuid(),
  code: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/u),
  name: z.string().min(1).max(200),
  revision: z.int().positive(),
  productId: z.uuid(),
  sourceRef: z.string().min(1).max(256),
  verificationMode: z.literal("course_membership").optional(),
  published: z.boolean(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
});
export const listRulesInputSchema = z.object({ operationId });
export const saveRuleInputSchema = z.object({
  operationId,
  expectedRevision: z.int().positive().optional(),
  value: activationRuleSchema.omit({ revision: true }),
  reason: z.string().min(1).max(1000),
});
export const rulesOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("activationRules"),
    items: z.array(activationRuleSchema),
  }),
});
export const ruleOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("activationRule"),
    value: activationRuleSchema,
  }),
});
export const contentCatalogOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("content"),
    items: z.array(coverageEntrySchema),
  }),
});

export const lookupRecipientInputSchema = z.object({
  operationId,
  identityRef: z.string().trim().min(1).max(256),
});
export const recipientSchema = z.object({
  accountId: z.uuid(),
  accountRef: z.string(),
  identityRef: z.string(),
  linkRef: z.uuid(),
  linkRevision: z.int().positive(),
});
export const recipientOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("recipient"),
    value: z.discriminatedUnion("state", [
      z.object({ state: z.literal("found"), recipient: recipientSchema }),
      z.object({ state: z.literal("not_found") }),
      z.object({ state: z.literal("ambiguous") }),
    ]),
  }),
});
