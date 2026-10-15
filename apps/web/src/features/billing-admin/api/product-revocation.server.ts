import "server-only";
import { executeBillingCommand } from "@/entities/subscription.server";
import { handleAuthenticatedMutation } from "@/shared/auth/index.server";
import {
  requestPreviewProductRevocation,
  requestRevokeProductAccess,
} from "@/shared/api/backend/index.server";
import {
  productRevocationCommandSchema,
  productRevocationTargetSchema,
  productRevocationResponseSchema,
  productRevocationPreviewResponseSchema,
} from "../model/product-revocation";
export function handlePreviewProductRevocation(
  request: Request,
): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, token) =>
    executeBillingCommand(
      form,
      productRevocationTargetSchema,
      productRevocationPreviewResponseSchema,
      (input) => requestPreviewProductRevocation(input, token),
    ),
  );
}
export function handleRevokeProductAccess(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, token) =>
    executeBillingCommand(
      form,
      productRevocationCommandSchema,
      productRevocationResponseSchema,
      (input) => requestRevokeProductAccess(input, token),
    ),
  );
}
