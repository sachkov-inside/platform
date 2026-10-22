import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  billingCommandResultSchema,
  billingTransportFailure,
  purchaseStatusSchema,
  quoteSchema,
} from "@/entities/subscription";
import { purchaseInputSchema, quoteInputSchema } from "../model/checkout";

export const createBillingQuoteOperation = defineMutationOperation({
  input: quoteInputSchema,
  method: "POST",
  path: "/api/account/billing/quote",
  result: billingCommandResultSchema(quoteSchema),
  transportFailure: billingTransportFailure,
});

export const startBillingPurchaseOperation = defineMutationOperation({
  input: purchaseInputSchema,
  method: "POST",
  path: "/api/account/billing/purchase",
  result: billingCommandResultSchema(purchaseStatusSchema),
  transportFailure: billingTransportFailure,
});
