import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";
import {
  applyExpansionInputSchema,
  applyExpansionOutcomeSchema,
  assignEnrollmentInputSchema,
  changeEnrollmentInputSchema,
  enrollmentOutcomeSchema,
  enrollmentsOutcomeSchema,
  listRulesInputSchema,
  listTiersSchema,
  lookupRecipientInputSchema,
  previewExpansionInputSchema,
  previewExpansionOutcomeSchema,
  readEnrollmentsInputSchema,
  recipientOutcomeSchema,
  registerSourceInputSchema,
  ruleOutcomeSchema,
  rulesOutcomeSchema,
  saveRuleInputSchema,
  sourceOutcomeSchema,
  tiersOutcomeSchema,
  contentCatalogOutcomeSchema,
} from "../model/enrollment-operations";

export const listSubscriptionTiersOperation = defineMutationOperation({
  input: listTiersSchema,
  method: "POST",
  path: "/api/authoring/billing/tiers/list",
  result: billingCommandResultSchema(tiersOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const readTariffAssignmentsOperation = defineMutationOperation({
  input: readEnrollmentsInputSchema,
  method: "POST",
  path: "/api/authoring/billing/enrollments/list",
  result: billingCommandResultSchema(enrollmentsOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const assignTariffAssignmentOperation = defineMutationOperation({
  input: assignEnrollmentInputSchema,
  method: "POST",
  path: "/api/authoring/billing/enrollments/assign",
  result: billingCommandResultSchema(enrollmentOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const changeTariffAssignmentOperation = defineMutationOperation({
  input: changeEnrollmentInputSchema,
  method: "POST",
  path: "/api/authoring/billing/enrollments/change",
  result: billingCommandResultSchema(enrollmentOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const listActivationRulesOperation = defineMutationOperation({
  input: listRulesInputSchema,
  method: "POST",
  path: "/api/authoring/billing/activation-rules/list",
  result: billingCommandResultSchema(rulesOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const saveActivationRuleOperation = defineMutationOperation({
  input: saveRuleInputSchema,
  method: "POST",
  path: "/api/authoring/billing/activation-rules/save",
  result: billingCommandResultSchema(ruleOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const previewEnrollmentExpansionOperation = defineMutationOperation({
  input: previewExpansionInputSchema,
  method: "POST",
  path: "/api/authoring/billing/enrollments/preview-expansion",
  result: billingCommandResultSchema(previewExpansionOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const applyEnrollmentExpansionOperation = defineMutationOperation({
  input: applyExpansionInputSchema,
  method: "POST",
  path: "/api/authoring/billing/enrollments/apply-expansion",
  result: billingCommandResultSchema(applyExpansionOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const registerSubscriptionSourceOperation = defineMutationOperation({
  input: registerSourceInputSchema,
  method: "POST",
  path: "/api/authoring/billing/sources/register",
  result: billingCommandResultSchema(sourceOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const lookupSubscriptionRecipientOperation = defineMutationOperation({
  input: lookupRecipientInputSchema,
  method: "POST",
  path: "/api/authoring/billing/recipients/lookup",
  result: billingCommandResultSchema(recipientOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const readContentCatalogOperation = defineMutationOperation({
  input: listRulesInputSchema,
  method: "POST",
  path: "/api/authoring/billing/content/list",
  result: billingCommandResultSchema(contentCatalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});
