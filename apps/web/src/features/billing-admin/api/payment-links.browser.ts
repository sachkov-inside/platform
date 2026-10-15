import {
  billingCommandPayload,
  billingCommandResult,
} from "@/entities/subscription";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import {
  paymentLinkOutcomeSchema,
  paymentLinksOutcomeSchema,
  type CreatePaymentLinkInput,
  type RevokePaymentLinkInput,
  type ListPaymentLinksInput,
} from "../model/payment-link-operations";
export async function createPaymentLink(input: CreatePaymentLinkInput) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/payment-links/create",
      "POST",
      billingCommandPayload(input),
    ),
    paymentLinkOutcomeSchema,
  );
}
export async function revokePaymentLink(input: RevokePaymentLinkInput) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/payment-links/revoke",
      "POST",
      billingCommandPayload(input),
    ),
    paymentLinkOutcomeSchema,
  );
}
export async function listPaymentLinks(input: ListPaymentLinksInput) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/payment-links/list",
      "POST",
      billingCommandPayload(input),
    ),
    paymentLinksOutcomeSchema,
  );
}
