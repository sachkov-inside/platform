import {
  billingCommandPayload,
  readBillingEndpoint,
  type PriceSnapshot,
  billingCommandResult,
  type BillingCommandResult,
} from "@/entities/subscription";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import {
  catalogOutcomeSchema,
  ownerCatalogSchema,
  classificationOutcomeSchema,
  grantBatchOutcomeSchema,
  grantOutcomeSchema,
  grantPreviewOutcomeSchema,
  grantsOutcomeSchema,
  paymentOutcomeSchema,
  paymentsOutcomeSchema,
  reconciledOutcomeSchema,
  refundsOutcomeSchema,
  subscriptionOutcomeSchema,
  type CatalogOutcome,
  type ClassificationOutcome,
  type GrantBatchOutcome,
  type GrantOutcome,
  type GrantPreviewOutcome,
  type GrantsOutcome,
  type PaymentOutcome,
  type PaymentsOutcome,
  type ReconciledOutcome,
  type RefundsOutcome,
  type SubscriptionOutcome,
  type ApplyBatchInput,
  type ArchiveInput,
  type CancelSubscriptionInput,
  type ClassifyAccountInput,
  type ExtendGrantInput,
  type ListPaymentsInput,
  type PreviewBatchInput,
  type PurchaseCommandInput,
  type ReadPaymentInput,
  type ReadClassificationInput,
  type ReadGrantsInput,
  type RevokeGrantInput,
  type SaveOfferInput,
  type SavePaymentOptionInput,
  type SavePromotionInput,
  type SaveCohortInput,
} from "../model/admin-operations";

export async function saveBillingOffer(
  input: SaveOfferInput,
): Promise<BillingCommandResult<CatalogOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/offers/save",
      "POST",
      billingCommandPayload(input),
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
      billingCommandPayload(input),
    ),
    catalogOutcomeSchema,
  );
}

export async function publishBillingOffer(
  input: ArchiveInput,
): Promise<BillingCommandResult<CatalogOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/offers/publish",
      "POST",
      billingCommandPayload(input),
    ),
    catalogOutcomeSchema,
  );
}

export async function unpublishBillingOffer(
  input: ArchiveInput,
): Promise<BillingCommandResult<CatalogOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/offers/unpublish",
      "POST",
      billingCommandPayload(input),
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
      billingCommandPayload(input),
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
      billingCommandPayload(input),
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
      billingCommandPayload(input),
    ),
    catalogOutcomeSchema,
  );
}

export async function saveBillingCohort(
  input: SaveCohortInput,
): Promise<BillingCommandResult<CatalogOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/cohorts/save",
      "POST",
      billingCommandPayload(input),
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
      billingCommandPayload(input),
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
      billingCommandPayload(input),
    ),
    paymentsOutcomeSchema,
  );
}

export async function readBillingPayment(
  input: ReadPaymentInput,
): Promise<BillingCommandResult<PaymentOutcome>> {
  const read = async (command: ReadPaymentInput) =>
    billingCommandResult(
      await requestSameOriginMutation(
        "/api/authoring/billing/payments/read",
        "POST",
        billingCommandPayload(command),
      ),
      paymentOutcomeSchema,
    );
  const first = await read(input);
  if (!first.ok) return first;
  const audit = [...first.value.result.audit];
  const seen = new Set<string>();
  let cursor = first.value.result.nextAuditCursor;
  while (cursor !== null) {
    const key = JSON.stringify(cursor);
    if (seen.has(key) || cursor.purchaseRef !== input.purchaseRef.toLowerCase())
      return { ok: false, code: "unavailable" };
    seen.add(key);
    const page = await read({
      purchaseRef: input.purchaseRef,
      operationId: crypto.randomUUID(),
      auditCursor: cursor,
    });
    if (!page.ok) return page;
    audit.push(...page.value.result.audit);
    cursor = page.value.result.nextAuditCursor;
  }
  return {
    ...first,
    value: {
      ...first.value,
      result: { ...first.value.result, audit, nextAuditCursor: null },
    },
  };
}

export async function reconcileBillingPayment(
  input: PurchaseCommandInput,
): Promise<BillingCommandResult<ReconciledOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/payments/reconcile",
      "POST",
      billingCommandPayload(input),
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
      billingCommandPayload(input),
    ),
    subscriptionOutcomeSchema,
  );
}

export async function readBillingRefunds(
  input: PurchaseCommandInput,
): Promise<BillingCommandResult<RefundsOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/refunds/read",
      "POST",
      billingCommandPayload(input),
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
      billingCommandPayload(input),
    ),
    grantsOutcomeSchema,
  );
}

export async function readAccountClassification(
  input: ReadClassificationInput,
): Promise<BillingCommandResult<ClassificationOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/grants/read-classification",
      "POST",
      billingCommandPayload(input),
    ),
    classificationOutcomeSchema,
  );
}

export async function classifyAccount(
  input: ClassifyAccountInput,
): Promise<BillingCommandResult<ClassificationOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/grants/classify",
      "POST",
      billingCommandPayload(input),
    ),
    classificationOutcomeSchema,
  );
}

export async function previewAccessGrantBatch(
  input: PreviewBatchInput,
): Promise<BillingCommandResult<GrantPreviewOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/grants/preview-batch",
      "POST",
      billingCommandPayload(input),
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
      billingCommandPayload(input),
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
      billingCommandPayload(input),
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
      billingCommandPayload(input),
    ),
    grantOutcomeSchema,
  );
}

/** Re-read canonical prices and revisions after an acknowledged catalogue write. */
export function readOwnerBillingCatalog(): Promise<
  BillingCommandResult<PriceSnapshot[]>
> {
  return readBillingEndpoint(
    "/api/authoring/billing/catalog",
    ownerCatalogSchema,
  );
}
