import "server-only";
import {
  listActivationRulesOperation,
  lookupSubscriptionRecipientOperation,
  saveActivationRuleOperation,
  readContentCatalogOperation,
} from "./enrollments.operation";
import {
  billingInvalidInput,
  executeBillingOperation,
} from "@/entities/subscription.server";
import { requestManageBilling } from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";

export function handleListActivationRules(request: Request): Promise<Response> {
  return handleMutationOperation(request, listActivationRulesOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(listActivationRulesOperation, command, (input) =>
        requestManageBilling(
          { ...input, operation: "activationRules.list" },
          accessToken,
        ),
      ),
  });
}

export function handleSaveActivationRule(request: Request): Promise<Response> {
  return handleMutationOperation(request, saveActivationRuleOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(saveActivationRuleOperation, command, (input) => {
        const { expectedRevision, value: ruleValue, ...command } = input;
        const { verificationMode, ...rule } = ruleValue;
        return requestManageBilling(
          {
            ...command,
            value: {
              ...rule,
              ...(verificationMode === undefined ? {} : { verificationMode }),
            },
            ...(expectedRevision === undefined ? {} : { expectedRevision }),
            operation: "activationRules.save",
          },
          accessToken,
        );
      }),
  });
}

export function handleReadContentCatalog(request: Request): Promise<Response> {
  return handleMutationOperation(request, readContentCatalogOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(readContentCatalogOperation, command, (input) =>
        requestManageBilling(
          { ...input, operation: "content.list" },
          accessToken,
        ),
      ),
  });
}

export function handleLookupSubscriptionRecipient(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(
    request,
    lookupSubscriptionRecipientOperation,
    {
      invalidInput: billingInvalidInput,
      execute: (command, accessToken) =>
        executeBillingOperation(
          lookupSubscriptionRecipientOperation,
          command,
          (input) =>
            requestManageBilling(
              { ...input, operation: "recipients.lookup" },
              accessToken,
            ),
        ),
    },
  );
}
