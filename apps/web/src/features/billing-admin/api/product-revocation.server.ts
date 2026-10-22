import "server-only";
import {
  previewProductRevocationOperation,
  revokeProductAccessOperation,
} from "./product-revocation.operation";
import {
  billingInvalidInput,
  executeBillingOperation,
} from "@/entities/subscription.server";
import { handleMutationOperation } from "@/shared/auth/index.server";
import {
  requestPreviewProductRevocation,
  requestRevokeProductAccess,
} from "@/shared/api/backend/index.server";
export function handlePreviewProductRevocation(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, previewProductRevocationOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, token) =>
      executeBillingOperation(
        previewProductRevocationOperation,
        command,
        (input) => requestPreviewProductRevocation(input, token),
      ),
  });
}
export function handleRevokeProductAccess(request: Request): Promise<Response> {
  return handleMutationOperation(request, revokeProductAccessOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, token) =>
      executeBillingOperation(revokeProductAccessOperation, command, (input) =>
        requestRevokeProductAccess(input, token),
      ),
  });
}
