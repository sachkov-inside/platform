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
export function handleTributeStatus(request: Request): Promise<Response> {
  return handleMutationOperation(request, tributeStatusOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(tributeStatusOperation, command, (input) => {
        const { page, ...status } = input;
        return requestManageBilling(
          {
            ...status,
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
      executeBillingOperation(tributeSavePolicyOperation, command, (input) => {
        return requestManageBilling(
          { ...input, operation: "tribute.savePolicy" },
          accessToken,
        );
      }),
  });
}
export function handleTributePreview(request: Request): Promise<Response> {
  return handleMutationOperation(request, tributePreviewOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(tributePreviewOperation, command, (input) => {
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
      executeBillingOperation(tributeApplyOperation, command, (input) => {
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
      executeBillingOperation(tributeReconcileOperation, command, (input) => {
        const { confirmedTerms, ...command } = input;
        return requestManageBilling(
          {
            ...command,
            ...(confirmedTerms === undefined ? {} : { confirmedTerms }),
            operation: "tribute.reconcile",
          },
          accessToken,
        );
      }),
  });
}
export function handleTributeRetryEvent(request: Request): Promise<Response> {
  return handleMutationOperation(request, tributeRetryEventOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(tributeRetryEventOperation, command, (input) => {
        const { action, ...command } = input;
        return requestManageBilling(
          {
            ...command,
            ...(action === undefined ? {} : { action }),
            operation: "tribute.retryEvent",
          },
          accessToken,
        );
      }),
  });
}

export function handleTributeDismissImport(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, tributeDismissImportOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(tributeDismissImportOperation, command, (input) =>
        requestManageBilling(
          { ...input, operation: "tribute.dismissImport" },
          accessToken,
        ),
      ),
  });
}
