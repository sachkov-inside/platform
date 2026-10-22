import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";
import {
  createPaymentLinkInputSchema,
  listPaymentLinksInputSchema,
  paymentLinkOutcomeSchema,
  paymentLinksOutcomeSchema,
  revokePaymentLinkInputSchema,
} from "../model/payment-link-operations";

export const createPaymentLinkOperation = defineMutationOperation({
  input: createPaymentLinkInputSchema,
  method: "POST",
  path: "/api/authoring/billing/payment-links/create",
  result: billingCommandResultSchema(paymentLinkOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const revokePaymentLinkOperation = defineMutationOperation({
  input: revokePaymentLinkInputSchema,
  method: "POST",
  path: "/api/authoring/billing/payment-links/revoke",
  result: billingCommandResultSchema(paymentLinkOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const listPaymentLinksOperation = defineMutationOperation({
  input: listPaymentLinksInputSchema,
  method: "POST",
  path: "/api/authoring/billing/payment-links/list",
  result: billingCommandResultSchema(paymentLinksOutcomeSchema),
  transportFailure: billingTransportFailure,
});
