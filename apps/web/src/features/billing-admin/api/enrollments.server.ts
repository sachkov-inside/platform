import { registerSourceInputSchema, sourceOutcomeSchema } from "../model/enrollment-operations";
import { contentCatalogOutcomeSchema } from "../model/enrollment-operations";
import { applyExpansionInputSchema, applyExpansionOutcomeSchema } from "../model/enrollment-operations";
import { previewExpansionInputSchema, previewExpansionOutcomeSchema } from "../model/enrollment-operations";
import { saveRuleInputSchema, ruleOutcomeSchema } from "../model/enrollment-operations";
import { listRulesInputSchema, rulesOutcomeSchema } from "../model/enrollment-operations";
import "server-only";
import { executeBillingCommand } from "@/entities/subscription.server";
import { requestManageBilling } from "@/shared/api/backend/index.server";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";
import { assignEnrollmentInputSchema, changeEnrollmentInputSchema, enrollmentOutcomeSchema, enrollmentsOutcomeSchema, listTiersSchema, readEnrollmentsInputSchema, tiersOutcomeSchema } from "../model/enrollment-operations";
export function handleListSubscriptionTiers(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, listTiersSchema, tiersOutcomeSchema,
    input => requestManageBilling({ ...input, operation: "tiers.list" }, accessToken)));
}
export function handleReadSubscriptionEnrollments(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, readEnrollmentsInputSchema, enrollmentsOutcomeSchema,
    input => requestManageBilling({ ...input, operation: "enrollments.list" }, accessToken)));
}
export function handleAssignSubscriptionEnrollment(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, assignEnrollmentInputSchema, enrollmentOutcomeSchema,
    input => {
      const { courseSource, ...command } = input;
      return requestManageBilling({ ...command, ...(courseSource === undefined ? {} : { courseSource }), operation: "enrollments.assign" }, accessToken);
    }));
}
export function handleChangeSubscriptionEnrollment(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, changeEnrollmentInputSchema, enrollmentOutcomeSchema,
    input => requestManageBilling({ ...input, operation: "enrollments.change" }, accessToken)));
}

export function handleListActivationRules(request: Request): Promise<Response> { return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, listRulesInputSchema, rulesOutcomeSchema, input => requestManageBilling({ ...input, operation: "activationRules.list" }, accessToken))); }

export function handleSaveActivationRule(request: Request): Promise<Response> { return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, saveRuleInputSchema, ruleOutcomeSchema, input => { const { expectedRevision, ...command } = input; return requestManageBilling({ ...command, ...(expectedRevision === undefined ? {} : { expectedRevision }), operation: "activationRules.save" }, accessToken); })); }

export function handlePreviewEnrollmentExpansion(request: Request): Promise<Response> { return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, previewExpansionInputSchema, previewExpansionOutcomeSchema, input => requestManageBilling({ ...input, operation: "enrollments.previewExpansion" }, accessToken))); }

export function handleApplyEnrollmentExpansion(request: Request): Promise<Response> { return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, applyExpansionInputSchema, applyExpansionOutcomeSchema, input => requestManageBilling({ ...input, operation: "enrollments.applyExpansion" }, accessToken))); }

export function handleReadContentCatalog(request: Request): Promise<Response> { return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, listRulesInputSchema, contentCatalogOutcomeSchema, input => requestManageBilling({ ...input, operation: "content.list" }, accessToken))); }

export function handleRegisterSubscriptionSource(request: Request): Promise<Response> { return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, registerSourceInputSchema, sourceOutcomeSchema, input => requestManageBilling({ ...input, operation: "sources.register" }, accessToken))); }

import { lookupRecipientInputSchema, recipientOutcomeSchema } from "../model/enrollment-operations";
export function handleLookupSubscriptionRecipient(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) => executeBillingCommand(form, lookupRecipientInputSchema, recipientOutcomeSchema,
    input => requestManageBilling({ ...input, operation: "recipients.lookup" }, accessToken)));
}
