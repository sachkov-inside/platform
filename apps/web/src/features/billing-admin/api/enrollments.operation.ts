import { defineMutationOperation } from "@/shared/api/mutation-operation";
import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";
import {
  listRulesInputSchema,
  rulesOutcomeSchema,
  saveRuleInputSchema,
  ruleOutcomeSchema,
  lookupRecipientInputSchema,
  recipientOutcomeSchema,
  contentCatalogOutcomeSchema,
} from "../model/enrollment-operations";
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
