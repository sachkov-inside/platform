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
import {
  productRevocationResponseSchema,
  productRevocationPreviewResponseSchema,
} from "../model/product-revocation";
export function handlePreviewProductRevocation(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, previewProductRevocationOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, token) =>
      executeBillingOperation(
        command,
        productRevocationPreviewResponseSchema,
        (input) => requestPreviewProductRevocation(input, token),
      ),
  });
}
export function handleRevokeProductAccess(request: Request): Promise<Response> {
  return handleMutationOperation(request, revokeProductAccessOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, token) =>
      executeBillingOperation(
        command,
        productRevocationResponseSchema,
        (input) => requestRevokeProductAccess(input, token),
      ),
  });
}
