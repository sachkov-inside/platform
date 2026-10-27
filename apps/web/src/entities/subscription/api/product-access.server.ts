import "server-only";
import {
  requestIssueProductAccess,
  requestRestoreProductAccess,
} from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";
import {
  billingInvalidInput,
  executeBillingOperation,
} from "./billing-command.server";
import { issueProductAccessOperation } from "./product-access.operation";
export function handleIssueProductAccess(request: Request): Promise<Response> {
  return handleMutationOperation(request, issueProductAccessOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(issueProductAccessOperation, command, (input) =>
        requestIssueProductAccess(input, accessToken),
      ),
  });
}
import { restoreProductAccessOperation } from "./product-access.operation";
export function handleRestoreProductAccess(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, restoreProductAccessOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(restoreProductAccessOperation, command, (input) =>
        requestRestoreProductAccess(input, accessToken),
      ),
  });
}
