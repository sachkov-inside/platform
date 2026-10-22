import "server-only";
import {
  applyEnrollmentExpansionOperation,
  assignTariffAssignmentOperation,
  changeTariffAssignmentOperation,
  listActivationRulesOperation,
  listSubscriptionTiersOperation,
  lookupSubscriptionRecipientOperation,
  previewEnrollmentExpansionOperation,
  readTariffAssignmentsOperation,
  registerSubscriptionSourceOperation,
  saveActivationRuleOperation,
  readContentCatalogOperation,
} from "./enrollments.operation";
import {
  billingInvalidInput,
  executeBillingOperation,
} from "@/entities/subscription.server";
import { requestManageBilling } from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";
export function handleListSubscriptionTiers(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, listSubscriptionTiersOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(
        listSubscriptionTiersOperation,
        command,
        (input) =>
          requestManageBilling(
            {
              operationId: input.operationId,
              limit: input.limit,
              operation: "tiers.list",
              ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
            },
            accessToken,
          ),
      ),
  });
}
export function handleReadTariffAssignments(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, readTariffAssignmentsOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(
        readTariffAssignmentsOperation,
        command,
        (input) =>
          requestManageBilling(
            { ...input, operation: "enrollments.list" },
            accessToken,
          ),
      ),
  });
}
export function handleAssignTariffAssignment(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, assignTariffAssignmentOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(
        assignTariffAssignmentOperation,
        command,
        (input) => {
          const { courseSource, ...command } = input;
          return requestManageBilling(
            {
              ...command,
              ...(courseSource === undefined ? {} : { courseSource }),
              operation: "enrollments.assign",
            },
            accessToken,
          );
        },
      ),
  });
}
export function handleChangeTariffAssignment(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, changeTariffAssignmentOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(
        changeTariffAssignmentOperation,
        command,
        (input) =>
          requestManageBilling(
            { ...input, operation: "enrollments.change" },
            accessToken,
          ),
      ),
  });
}

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

export function handlePreviewEnrollmentExpansion(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, previewEnrollmentExpansionOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(
        previewEnrollmentExpansionOperation,
        command,
        (input) =>
          requestManageBilling(
            { ...input, operation: "enrollments.previewExpansion" },
            accessToken,
          ),
      ),
  });
}

export function handleApplyEnrollmentExpansion(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, applyEnrollmentExpansionOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(
        applyEnrollmentExpansionOperation,
        command,
        (input) =>
          requestManageBilling(
            { ...input, operation: "enrollments.applyExpansion" },
            accessToken,
          ),
      ),
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

export function handleRegisterSubscriptionSource(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, registerSubscriptionSourceOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(
        registerSubscriptionSourceOperation,
        command,
        (input) =>
          requestManageBilling(
            { ...input, operation: "sources.register" },
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
