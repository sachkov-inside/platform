import {
  billingCommandResult,
  type BillingCommandResult,
} from "@/entities/subscription";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import {
  catalogOutcomeSchema,
  grantBatchOutcomeSchema,
  grantOutcomeSchema,
  grantPreviewOutcomeSchema,
  grantsOutcomeSchema,
  paymentOutcomeSchema,
  paymentsOutcomeSchema,
  reconciledOutcomeSchema,
  refundDecisionOutcomeSchema,
  refundsOutcomeSchema,
  subscriptionOutcomeSchema,
  type CatalogOutcome,
  type GrantBatchOutcome,
  type GrantOutcome,
  type GrantPreviewOutcome,
  type GrantsOutcome,
  type PaymentOutcome,
  type PaymentsOutcome,
  type ReconciledOutcome,
  type RefundDecisionOutcome,
  type RefundsOutcome,
  type SubscriptionOutcome,
  type ApplyBatchInput,
  type ArchiveInput,
  type CancelSubscriptionInput,
  type DecideRefundInput,
  type ExecuteRefundInput,
  type ExtendGrantInput,
  type ListPaymentsInput,
  type PreviewBatchInput,
  type PurchaseCommandInput,
  type ReadGrantsInput,
  type RevokeGrantInput,
  type SaveOfferInput,
  type SavePaymentOptionInput,
  type SavePromotionInput,
} from "../model/admin-operations";

function payload(input: unknown): FormData {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  return form;
}

export async function saveBillingOffer(
  input: SaveOfferInput,
): Promise<BillingCommandResult<CatalogOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/offers/save",
      "POST",
      payload(input),
    ),
    catalogOutcomeSchema,
  );
}

export async function archiveBillingOffer(
  input: ArchiveInput,
): Promise<BillingCommandResult<CatalogOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/offers/archive",
      "POST",
      payload(input),
    ),
    catalogOutcomeSchema,
  );
}

export async function saveBillingPaymentOption(
  input: SavePaymentOptionInput,
): Promise<BillingCommandResult<CatalogOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/payment-options/save",
      "POST",
      payload(input),
    ),
    catalogOutcomeSchema,
  );
}

export async function archiveBillingPaymentOption(
  input: ArchiveInput,
): Promise<BillingCommandResult<CatalogOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/payment-options/archive",
      "POST",
      payload(input),
    ),
    catalogOutcomeSchema,
  );
}

export async function saveBillingPromotion(
  input: SavePromotionInput,
): Promise<BillingCommandResult<CatalogOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/promotions/save",
      "POST",
      payload(input),
    ),
    catalogOutcomeSchema,
  );
}

export async function archiveBillingPromotion(
  input: ArchiveInput,
): Promise<BillingCommandResult<CatalogOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/promotions/archive",
      "POST",
      payload(input),
    ),
    catalogOutcomeSchema,
  );
}

export async function listBillingPayments(
  input: ListPaymentsInput,
): Promise<BillingCommandResult<PaymentsOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/payments/list",
      "POST",
      payload(input),
    ),
    paymentsOutcomeSchema,
  );
}

export async function readBillingPayment(
  input: PurchaseCommandInput,
): Promise<BillingCommandResult<PaymentOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/payments/read",
      "POST",
      payload(input),
    ),
    paymentOutcomeSchema,
  );
}

export async function reconcileBillingPayment(
  input: PurchaseCommandInput,
): Promise<BillingCommandResult<ReconciledOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/payments/reconcile",
      "POST",
      payload(input),
    ),
    reconciledOutcomeSchema,
  );
}

export async function cancelOwnerSubscription(
  input: CancelSubscriptionInput,
): Promise<BillingCommandResult<SubscriptionOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/subscriptions/cancel",
      "POST",
      payload(input),
    ),
    subscriptionOutcomeSchema,
  );
}

export async function decideBillingRefund(
  input: DecideRefundInput,
): Promise<BillingCommandResult<RefundDecisionOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/refunds/decide",
      "POST",
      payload(input),
    ),
    refundDecisionOutcomeSchema,
  );
}

export async function executeBillingRefund(
  input: ExecuteRefundInput,
): Promise<BillingCommandResult<RefundDecisionOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/refunds/execute",
      "POST",
      payload(input),
    ),
    refundDecisionOutcomeSchema,
  );
}

export async function readBillingRefunds(
  input: PurchaseCommandInput,
): Promise<BillingCommandResult<RefundsOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/refunds/read",
      "POST",
      payload(input),
    ),
    refundsOutcomeSchema,
  );
}

export async function readAccessGrants(
  input: ReadGrantsInput,
): Promise<BillingCommandResult<GrantsOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/grants/read",
      "POST",
      payload(input),
    ),
    grantsOutcomeSchema,
  );
}

export async function previewAccessGrantBatch(
  input: PreviewBatchInput,
): Promise<BillingCommandResult<GrantPreviewOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/grants/preview-batch",
      "POST",
      payload(input),
    ),
    grantPreviewOutcomeSchema,
  );
}

export async function applyAccessGrantBatch(
  input: ApplyBatchInput,
): Promise<BillingCommandResult<GrantBatchOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/grants/apply-batch",
      "POST",
      payload(input),
    ),
    grantBatchOutcomeSchema,
  );
}

export async function extendAccessGrant(
  input: ExtendGrantInput,
): Promise<BillingCommandResult<GrantOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/grants/extend",
      "POST",
      payload(input),
    ),
    grantOutcomeSchema,
  );
}

export async function revokeAccessGrant(
  input: RevokeGrantInput,
): Promise<BillingCommandResult<GrantOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/grants/revoke",
      "POST",
      payload(input),
    ),
    grantOutcomeSchema,
  );
}
