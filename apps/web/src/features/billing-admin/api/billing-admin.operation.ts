import { defineMutationOperation } from "@/shared/api/mutation-operation";
import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";
import {
  archiveInputSchema,
  catalogOutcomeSchema,
  listPaymentsInputSchema,
  paymentOutcomeSchema,
  paymentsOutcomeSchema,
  purchaseInputSchema,
  readPaymentInputSchema,
  reconciledOutcomeSchema,
  refundsOutcomeSchema,
  saveCohortInputSchema,
  savePromotionInputSchema,
} from "../model/admin-operations";
export const saveBillingPromotionOperation = defineMutationOperation({
  input: savePromotionInputSchema,
  method: "POST",
  path: "/api/authoring/billing/promotions/save",
  result: billingCommandResultSchema(catalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});
export const saveBillingCohortOperation = defineMutationOperation({
  input: saveCohortInputSchema,
  method: "POST",
  path: "/api/authoring/billing/cohorts/save",
  result: billingCommandResultSchema(catalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});
export const archiveBillingPromotionOperation = defineMutationOperation({
  input: archiveInputSchema,
  method: "POST",
  path: "/api/authoring/billing/promotions/archive",
  result: billingCommandResultSchema(catalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});
export const listBillingPaymentsOperation = defineMutationOperation({
  input: listPaymentsInputSchema,
  method: "POST",
  path: "/api/authoring/billing/payments/list",
  result: billingCommandResultSchema(paymentsOutcomeSchema),
  transportFailure: billingTransportFailure,
});
export const readBillingPaymentOperation = defineMutationOperation({
  input: readPaymentInputSchema,
  method: "POST",
  path: "/api/authoring/billing/payments/read",
  result: billingCommandResultSchema(paymentOutcomeSchema),
  transportFailure: billingTransportFailure,
});
export const reconcileBillingPaymentOperation = defineMutationOperation({
  input: purchaseInputSchema,
  method: "POST",
  path: "/api/authoring/billing/payments/reconcile",
  result: billingCommandResultSchema(reconciledOutcomeSchema),
  transportFailure: billingTransportFailure,
});
export const readBillingRefundsOperation = defineMutationOperation({
  input: purchaseInputSchema,
  method: "POST",
  path: "/api/authoring/billing/refunds/read",
  result: billingCommandResultSchema(refundsOutcomeSchema),
  transportFailure: billingTransportFailure,
});
