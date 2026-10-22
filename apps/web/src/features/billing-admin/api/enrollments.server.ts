import "server-only";
import {
  sourceOutcomeSchema,
  contentCatalogOutcomeSchema,
  applyExpansionOutcomeSchema,
  previewExpansionOutcomeSchema,
  ruleOutcomeSchema,
  rulesOutcomeSchema,
  enrollmentOutcomeSchema,
  enrollmentsOutcomeSchema,
  tiersOutcomeSchema,
  recipientOutcomeSchema,
} from "../model/enrollment-operations";
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
      executeBillingOperation(command, tiersOutcomeSchema, (input) =>
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
      executeBillingOperation(command, enrollmentsOutcomeSchema, (input) =>
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
      executeBillingOperation(command, enrollmentOutcomeSchema, (input) => {
        const { courseSource, ...command } = input;
        return requestManageBilling(
          {
            ...command,
            ...(courseSource === undefined ? {} : { courseSource }),
            operation: "enrollments.assign",
          },
          accessToken,
        );
      }),
  });
}
export function handleChangeTariffAssignment(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, changeTariffAssignmentOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(command, enrollmentOutcomeSchema, (input) =>
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
      executeBillingOperation(command, rulesOutcomeSchema, (input) =>
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
      executeBillingOperation(command, ruleOutcomeSchema, (input) => {
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
      executeBillingOperation(command, previewExpansionOutcomeSchema, (input) =>
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
      executeBillingOperation(command, applyExpansionOutcomeSchema, (input) =>
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
      executeBillingOperation(command, contentCatalogOutcomeSchema, (input) =>
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
      executeBillingOperation(command, sourceOutcomeSchema, (input) =>
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
        executeBillingOperation(command, recipientOutcomeSchema, (input) =>
          requestManageBilling(
            { ...input, operation: "recipients.lookup" },
            accessToken,
          ),
        ),
    },
  );
}
