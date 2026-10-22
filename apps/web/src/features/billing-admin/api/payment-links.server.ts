import "server-only";
import {
  createPaymentLinkOperation,
  listPaymentLinksOperation,
  revokePaymentLinkOperation,
} from "./payment-links.operation";
import { ownerCommand } from "./billing-admin.server";
export function handleCreatePaymentLink(request: Request): Promise<Response> {
  return ownerCommand(request, createPaymentLinkOperation, (input) => ({
    ...input,
    operation: "paymentLinks.create",
  }));
}
export function handleRevokePaymentLink(request: Request): Promise<Response> {
  return ownerCommand(request, revokePaymentLinkOperation, (input) => ({
    ...input,
    operation: "paymentLinks.revoke",
  }));
}
export function handleListPaymentLinks(request: Request): Promise<Response> {
  return ownerCommand(request, listPaymentLinksOperation, (input) => ({
    operationId: input.operationId,
    limit: input.limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    operation: "paymentLinks.list",
  }));
}
