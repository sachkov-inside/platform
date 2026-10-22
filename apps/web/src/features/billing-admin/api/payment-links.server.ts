import "server-only";
import {
  createPaymentLinkOperation,
  listPaymentLinksOperation,
  revokePaymentLinkOperation,
} from "./payment-links.operation";
import { ownerCommand } from "./billing-admin.server";
import {
  paymentLinkOutcomeSchema,
  paymentLinksOutcomeSchema,
} from "../model/payment-link-operations";
export function handleCreatePaymentLink(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    createPaymentLinkOperation,
    paymentLinkOutcomeSchema,
    (input) => ({ ...input, operation: "paymentLinks.create" }),
  );
}
export function handleRevokePaymentLink(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    revokePaymentLinkOperation,
    paymentLinkOutcomeSchema,
    (input) => ({ ...input, operation: "paymentLinks.revoke" }),
  );
}
export function handleListPaymentLinks(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    listPaymentLinksOperation,
    paymentLinksOutcomeSchema,
    (input) => ({
      operationId: input.operationId,
      limit: input.limit,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      operation: "paymentLinks.list",
    }),
  );
}
