import { type registerSourceInputSchema, sourceOutcomeSchema } from "../model/enrollment-operations";
import { contentCatalogOutcomeSchema } from "../model/enrollment-operations";
import type { applyExpansionInputSchema} from "../model/enrollment-operations";
import { applyExpansionOutcomeSchema } from "../model/enrollment-operations";
import type { previewExpansionInputSchema} from "../model/enrollment-operations";
import { previewExpansionOutcomeSchema } from "../model/enrollment-operations";
import type { saveRuleInputSchema} from "../model/enrollment-operations";
import { ruleOutcomeSchema } from "../model/enrollment-operations";
import type { listRulesInputSchema} from "../model/enrollment-operations";
import { rulesOutcomeSchema } from "../model/enrollment-operations";
import type { z } from "zod";
import { billingCommandPayload, billingCommandResult } from "@/entities/subscription";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import type { assignEnrollmentInputSchema, changeEnrollmentInputSchema, listTiersSchema, readEnrollmentsInputSchema} from "../model/enrollment-operations";
import { enrollmentOutcomeSchema, enrollmentsOutcomeSchema, tiersOutcomeSchema } from "../model/enrollment-operations";
export async function listSubscriptionTiers(input: z.infer<typeof listTiersSchema>) {
  return billingCommandResult(await requestSameOriginMutation("/api/authoring/billing/tiers/list", "POST", billingCommandPayload(input)), tiersOutcomeSchema);
}
export async function readSubscriptionEnrollments(input: z.infer<typeof readEnrollmentsInputSchema>) {
  return billingCommandResult(await requestSameOriginMutation("/api/authoring/billing/enrollments/list", "POST", billingCommandPayload(input)), enrollmentsOutcomeSchema);
}
export async function assignSubscriptionEnrollment(input: z.infer<typeof assignEnrollmentInputSchema>) {
  return billingCommandResult(await requestSameOriginMutation("/api/authoring/billing/enrollments/assign", "POST", billingCommandPayload(input)), enrollmentOutcomeSchema);
}
export async function changeSubscriptionEnrollment(input: z.infer<typeof changeEnrollmentInputSchema>) {
  return billingCommandResult(await requestSameOriginMutation("/api/authoring/billing/enrollments/change", "POST", billingCommandPayload(input)), enrollmentOutcomeSchema);
}

export async function listActivationRules(input: z.infer<typeof listRulesInputSchema>) { return billingCommandResult(await requestSameOriginMutation("/api/authoring/billing/activation-rules/list", "POST", billingCommandPayload(input)), rulesOutcomeSchema); }

export async function saveActivationRule(input: z.infer<typeof saveRuleInputSchema>) { return billingCommandResult(await requestSameOriginMutation("/api/authoring/billing/activation-rules/save", "POST", billingCommandPayload(input)), ruleOutcomeSchema); }

export async function previewEnrollmentExpansion(input: z.infer<typeof previewExpansionInputSchema>) { return billingCommandResult(await requestSameOriginMutation("/api/authoring/billing/enrollments/preview-expansion", "POST", billingCommandPayload(input)), previewExpansionOutcomeSchema); }

export async function applyEnrollmentExpansion(input: z.infer<typeof applyExpansionInputSchema>) { return billingCommandResult(await requestSameOriginMutation("/api/authoring/billing/enrollments/apply-expansion", "POST", billingCommandPayload(input)), applyExpansionOutcomeSchema); }

export async function readContentCatalog() { return billingCommandResult(await requestSameOriginMutation("/api/authoring/billing/content/list", "POST", billingCommandPayload({ operationId: crypto.randomUUID() })), contentCatalogOutcomeSchema); }

export async function registerSubscriptionSource(input: z.infer<typeof registerSourceInputSchema>) { return billingCommandResult(await requestSameOriginMutation("/api/authoring/billing/sources/register", "POST", billingCommandPayload(input)), sourceOutcomeSchema); }

import { type lookupRecipientInputSchema, recipientOutcomeSchema } from "../model/enrollment-operations";
export async function lookupSubscriptionRecipient(input: z.infer<typeof lookupRecipientInputSchema>) {
  return billingCommandResult(await requestSameOriginMutation("/api/authoring/billing/recipients/lookup", "POST", billingCommandPayload(input)), recipientOutcomeSchema);
}
