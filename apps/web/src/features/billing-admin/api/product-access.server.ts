import "server-only";
import {
  requestListProductAccess,
  requestReadProductAccess,
  requestIssueProductAccess,
  requestRestoreProductAccess,
} from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";
import {
  billingInvalidInput,
  executeBillingOperation,
} from "@/entities/subscription.server";
import { listProductAccessOperation } from "./product-access.operation";
export function handleListProductAccess(request: Request): Promise<Response> {
  return handleMutationOperation(request, listProductAccessOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(listProductAccessOperation, command, (input) =>
        requestListProductAccess(
          {
            limit: input.limit,
            ...(input.accountId === undefined
              ? {}
              : { accountId: input.accountId }),
            ...(input.productId === undefined
              ? {}
              : { productId: input.productId }),
            ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          },
          accessToken,
        ),
      ),
  });
}
import { readProductAccessOperation } from "./product-access.operation";
export function handleReadProductAccess(request: Request): Promise<Response> {
  return handleMutationOperation(request, readProductAccessOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, accessToken) =>
      executeBillingOperation(readProductAccessOperation, command, (input) =>
        requestReadProductAccess(input, accessToken),
      ),
  });
}
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
