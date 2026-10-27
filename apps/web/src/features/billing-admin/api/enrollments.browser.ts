import {
  listActivationRulesOperation,
  saveActivationRuleOperation,
  readContentCatalogOperation,
  lookupSubscriptionRecipientOperation,
} from "./enrollments.operation";
export const listActivationRules = listActivationRulesOperation.send;
export const saveActivationRule = saveActivationRuleOperation.send;
export const lookupSubscriptionRecipient =
  lookupSubscriptionRecipientOperation.send;
export function readContentCatalog() {
  return readContentCatalogOperation.send({ operationId: crypto.randomUUID() });
}
