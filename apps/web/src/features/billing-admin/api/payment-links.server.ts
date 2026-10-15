import "server-only";
import { ownerCommand } from "./billing-admin.server";
import {
  createPaymentLinkInputSchema,
  revokePaymentLinkInputSchema,
  listPaymentLinksInputSchema,
  paymentLinkOutcomeSchema,
  paymentLinksOutcomeSchema,
} from "../model/payment-link-operations";
export function handleCreatePaymentLink(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    createPaymentLinkInputSchema,
    paymentLinkOutcomeSchema,
    (input) => ({ ...input, operation: "paymentLinks.create" }),
  );
}
export function handleRevokePaymentLink(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    revokePaymentLinkInputSchema,
    paymentLinkOutcomeSchema,
    (input) => ({ ...input, operation: "paymentLinks.revoke" }),
  );
}
export function handleListPaymentLinks(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    listPaymentLinksInputSchema,
    paymentLinksOutcomeSchema,
    (input) => ({
      operationId: input.operationId,
      limit: input.limit,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      operation: "paymentLinks.list",
    }),
  );
}
