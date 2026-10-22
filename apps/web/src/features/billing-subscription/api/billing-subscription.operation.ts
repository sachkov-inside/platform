import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  billingCommandResultSchema,
  billingTransportFailure,
  changeQuoteSchema,
  changeResultSchema,
  subscriptionViewSchema,
} from "@/entities/subscription";
import {
  changeInputSchema,
  changeQuoteInputSchema,
  methodChangeValueSchema,
  resumeInputSchema,
  revisionCommandSchema,
  revokeMethodInputSchema,
} from "../model/subscription-commands";

export const cancelBillingRenewalOperation = defineMutationOperation({
  input: revisionCommandSchema,
  method: "POST",
  path: "/api/account/billing/subscription/cancel",
  result: billingCommandResultSchema(subscriptionViewSchema),
  transportFailure: billingTransportFailure,
});

export const resumeBillingRenewalOperation = defineMutationOperation({
  input: resumeInputSchema,
  method: "POST",
  path: "/api/account/billing/subscription/resume",
  result: billingCommandResultSchema(subscriptionViewSchema),
  transportFailure: billingTransportFailure,
});

export const quoteBillingChangeOperation = defineMutationOperation({
  input: changeQuoteInputSchema,
  method: "POST",
  path: "/api/account/billing/subscription/change-quote",
  result: billingCommandResultSchema(changeQuoteSchema),
  transportFailure: billingTransportFailure,
});

export const changeBillingOptionOperation = defineMutationOperation({
  input: changeInputSchema,
  method: "POST",
  path: "/api/account/billing/subscription/change",
  result: billingCommandResultSchema(changeResultSchema),
  transportFailure: billingTransportFailure,
});

export const cancelBillingChangeOperation = defineMutationOperation({
  input: revisionCommandSchema,
  method: "POST",
  path: "/api/account/billing/subscription/change-cancel",
  result: billingCommandResultSchema(subscriptionViewSchema),
  transportFailure: billingTransportFailure,
});

export const changeBillingPaymentMethodOperation = defineMutationOperation({
  input: revisionCommandSchema,
  method: "POST",
  path: "/api/account/billing/payment-method/change",
  result: billingCommandResultSchema(methodChangeValueSchema),
  transportFailure: billingTransportFailure,
});

export const revokeBillingPaymentMethodOperation = defineMutationOperation({
  input: revokeMethodInputSchema,
  method: "POST",
  path: "/api/account/billing/payment-method/revoke",
  result: billingCommandResultSchema(subscriptionViewSchema),
  transportFailure: billingTransportFailure,
});
