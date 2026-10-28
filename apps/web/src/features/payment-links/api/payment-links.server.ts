import "server-only";

import { ownerBillingCommand } from "@/entities/subscription.server";

import {
  createOwnerPaymentLinkOperation,
  listOwnerPaymentLinksOperation,
  revokeOwnerPaymentLinkOperation,
} from "./payment-links.operation";

export function handleCreatePaymentLink(request: Request): Promise<Response> {
  return ownerBillingCommand(
    request,
    createOwnerPaymentLinkOperation,
    (input) => ({ ...input, operation: "paymentLinks.create" }),
  );
}

export function handleRevokePaymentLink(request: Request): Promise<Response> {
  return ownerBillingCommand(
    request,
    revokeOwnerPaymentLinkOperation,
    (input) => ({ ...input, operation: "paymentLinks.revoke" }),
  );
}

export function handleListPaymentLinks(request: Request): Promise<Response> {
  return ownerBillingCommand(
    request,
    listOwnerPaymentLinksOperation,
    (input) => ({
      operation: "paymentLinks.list",
      operationId: input.operationId,
      limit: input.limit,
      ...(input.productId === undefined ? {} : { productId: input.productId }),
      ...(input.state === undefined ? {} : { state: input.state }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    }),
  );
}
