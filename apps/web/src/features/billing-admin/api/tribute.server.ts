import "server-only";
import {
  tributeApplyOperation,
  tributeDismissImportOperation,
  tributePreviewOperation,
  tributeReconcileOperation,
  tributeRetryEventOperation,
  tributeSavePolicyOperation,
  tributeStatusOperation,
} from "./tribute.operation";
import {
  billingInvalidInput,
  executeBillingOperation,
} from "@/entities/subscription.server";
import { requestManageBilling } from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";
import {
  tributeStatusOutcomeSchema,
  tributeSavePolicyOutcomeSchema,
  tributePreviewOutcomeSchema,
  tributeApplyOutcomeSchema,
  tributeReconcileOutcomeSchema,
  tributeRetryEventOutcomeSchema,
  tributeDismissImportOutcomeSchema,
} from "../model/tribute-operations";
export function handleTributeStatus(request: Request): Promise<Response> {
  return handleMutationOperation(request, tributeStatusOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(command, tributeStatusOutcomeSchema, (input) => {
        const { page, ...command } = input;
        return requestManageBilling(
          {
            ...command,
            ...(page === undefined ? {} : { page }),
            operation: "tribute.status",
          },
          accessToken,
        );
      }),
  });
}
export function handleTributeSavePolicy(request: Request): Promise<Response> {
  return handleMutationOperation(request, tributeSavePolicyOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(
        command,
        tributeSavePolicyOutcomeSchema,
        (input) => {
          return requestManageBilling(
            { ...input, operation: "tribute.savePolicy" },
            accessToken,
          );
        },
      ),
  });
}
export function handleTributePreview(request: Request): Promise<Response> {
  return handleMutationOperation(request, tributePreviewOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(command, tributePreviewOutcomeSchema, (input) => {
        return requestManageBilling(
          { ...input, operation: "tribute.preview" },
          accessToken,
        );
      }),
  });
}
export function handleTributeApply(request: Request): Promise<Response> {
  return handleMutationOperation(request, tributeApplyOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(command, tributeApplyOutcomeSchema, (input) => {
        return requestManageBilling(
          { ...input, operation: "tribute.apply" },
          accessToken,
        );
      }),
  });
}
export function handleTributeReconcile(request: Request): Promise<Response> {
  return handleMutationOperation(request, tributeReconcileOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(
        command,
        tributeReconcileOutcomeSchema,
        (input) => {
          const { confirmedTerms, ...command } = input;
          return requestManageBilling(
            {
              ...command,
              ...(confirmedTerms === undefined ? {} : { confirmedTerms }),
              operation: "tribute.reconcile",
            },
            accessToken,
          );
        },
      ),
  });
}
export function handleTributeRetryEvent(request: Request): Promise<Response> {
  return handleMutationOperation(request, tributeRetryEventOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(
        command,
        tributeRetryEventOutcomeSchema,
        (input) => {
          const { action, ...command } = input;
          return requestManageBilling(
            {
              ...command,
              ...(action === undefined ? {} : { action }),
              operation: "tribute.retryEvent",
            },
            accessToken,
          );
        },
      ),
  });
}

export function handleTributeDismissImport(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, tributeDismissImportOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(
        command,
        tributeDismissImportOutcomeSchema,
        (input) =>
          requestManageBilling(
            { ...input, operation: "tribute.dismissImport" },
            accessToken,
          ),
      ),
  });
}
