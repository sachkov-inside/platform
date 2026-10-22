import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";
import {
  applyBatchInputSchema,
  archiveInputSchema,
  cancelSubscriptionInputSchema,
  catalogOutcomeSchema,
  classificationOutcomeSchema,
  classifyAccountInputSchema,
  extendGrantInputSchema,
  grantBatchOutcomeSchema,
  grantOutcomeSchema,
  grantPreviewOutcomeSchema,
  grantsOutcomeSchema,
  listPaymentsInputSchema,
  paymentsOutcomeSchema,
  previewBatchInputSchema,
  purchaseInputSchema,
  readClassificationInputSchema,
  readGrantsInputSchema,
  reconciledOutcomeSchema,
  refundsOutcomeSchema,
  revokeGrantInputSchema,
  saveCohortInputSchema,
  saveOfferInputSchema,
  savePaymentOptionInputSchema,
  savePromotionInputSchema,
  subscriptionOutcomeSchema,
  readPaymentInputSchema,
  paymentOutcomeSchema,
  decideRefundInputSchema,
  executeRefundInputSchema,
} from "../model/admin-operations";

export const saveBillingOfferOperation = defineMutationOperation({
  input: saveOfferInputSchema,
  method: "POST",
  path: "/api/authoring/billing/offers/save",
  result: billingCommandResultSchema(catalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const archiveBillingOfferOperation = defineMutationOperation({
  input: archiveInputSchema,
  method: "POST",
  path: "/api/authoring/billing/offers/archive",
  result: billingCommandResultSchema(catalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const publishBillingOfferOperation = defineMutationOperation({
  input: archiveInputSchema,
  method: "POST",
  path: "/api/authoring/billing/offers/publish",
  result: billingCommandResultSchema(catalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const unpublishBillingOfferOperation = defineMutationOperation({
  input: archiveInputSchema,
  method: "POST",
  path: "/api/authoring/billing/offers/unpublish",
  result: billingCommandResultSchema(catalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const saveBillingPaymentOptionOperation = defineMutationOperation({
  input: savePaymentOptionInputSchema,
  method: "POST",
  path: "/api/authoring/billing/payment-options/save",
  result: billingCommandResultSchema(catalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const archiveBillingPaymentOptionOperation = defineMutationOperation({
  input: archiveInputSchema,
  method: "POST",
  path: "/api/authoring/billing/payment-options/archive",
  result: billingCommandResultSchema(catalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});

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

export const reconcileBillingPaymentOperation = defineMutationOperation({
  input: purchaseInputSchema,
  method: "POST",
  path: "/api/authoring/billing/payments/reconcile",
  result: billingCommandResultSchema(reconciledOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const cancelOwnerSubscriptionOperation = defineMutationOperation({
  input: cancelSubscriptionInputSchema,
  method: "POST",
  path: "/api/authoring/billing/subscriptions/cancel",
  result: billingCommandResultSchema(subscriptionOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const readBillingRefundsOperation = defineMutationOperation({
  input: purchaseInputSchema,
  method: "POST",
  path: "/api/authoring/billing/refunds/read",
  result: billingCommandResultSchema(refundsOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const readAccessGrantsOperation = defineMutationOperation({
  input: readGrantsInputSchema,
  method: "POST",
  path: "/api/authoring/billing/grants/read",
  result: billingCommandResultSchema(grantsOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const readAccountClassificationOperation = defineMutationOperation({
  input: readClassificationInputSchema,
  method: "POST",
  path: "/api/authoring/billing/grants/read-classification",
  result: billingCommandResultSchema(classificationOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const classifyAccountOperation = defineMutationOperation({
  input: classifyAccountInputSchema,
  method: "POST",
  path: "/api/authoring/billing/grants/classify",
  result: billingCommandResultSchema(classificationOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const previewAccessGrantBatchOperation = defineMutationOperation({
  input: previewBatchInputSchema,
  method: "POST",
  path: "/api/authoring/billing/grants/preview-batch",
  result: billingCommandResultSchema(grantPreviewOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const applyAccessGrantBatchOperation = defineMutationOperation({
  input: applyBatchInputSchema,
  method: "POST",
  path: "/api/authoring/billing/grants/apply-batch",
  result: billingCommandResultSchema(grantBatchOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const extendAccessGrantOperation = defineMutationOperation({
  input: extendGrantInputSchema,
  method: "POST",
  path: "/api/authoring/billing/grants/extend",
  result: billingCommandResultSchema(grantOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const revokeAccessGrantOperation = defineMutationOperation({
  input: revokeGrantInputSchema,
  method: "POST",
  path: "/api/authoring/billing/grants/revoke",
  result: billingCommandResultSchema(grantOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const readBillingPaymentOperation = defineMutationOperation({
  input: readPaymentInputSchema,
  method: "POST",
  path: "/api/authoring/billing/payments/read",
  result: billingCommandResultSchema(paymentOutcomeSchema),
  transportFailure: billingTransportFailure,
});

/** Historical refund routes: they keep Origin and session checks and answer method_unavailable. */
export const decideBillingRefundOperation = defineMutationOperation({
  input: decideRefundInputSchema,
  method: "POST",
  path: "/api/authoring/billing/refunds/decide",
  result: billingCommandResultSchema(z.never()),
  transportFailure: billingTransportFailure,
});

export const executeBillingRefundOperation = defineMutationOperation({
  input: executeRefundInputSchema,
  method: "POST",
  path: "/api/authoring/billing/refunds/execute",
  result: billingCommandResultSchema(z.never()),
  transportFailure: billingTransportFailure,
});
