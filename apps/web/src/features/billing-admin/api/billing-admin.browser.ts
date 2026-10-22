import {
  readBillingPaymentOperation,
  saveBillingOfferOperation,
  archiveBillingOfferOperation,
  publishBillingOfferOperation,
  unpublishBillingOfferOperation,
  saveBillingPaymentOptionOperation,
  archiveBillingPaymentOptionOperation,
  saveBillingPromotionOperation,
  saveBillingCohortOperation,
  archiveBillingPromotionOperation,
  listBillingPaymentsOperation,
  reconcileBillingPaymentOperation,
  cancelOwnerSubscriptionOperation,
  readBillingRefundsOperation,
  readAccessGrantsOperation,
  readAccountClassificationOperation,
  classifyAccountOperation,
  previewAccessGrantBatchOperation,
  applyAccessGrantBatchOperation,
  extendAccessGrantOperation,
  revokeAccessGrantOperation,
} from "./billing-admin.operation";
import {
  readBillingEndpoint,
  type PriceSnapshot,
  type BillingCommandResult,
} from "@/entities/subscription";
import {
  ownerCatalogSchema,
  type PaymentOutcome,
  type ReadPaymentInput,
} from "../model/admin-operations";

export const saveBillingOffer = saveBillingOfferOperation.send;

export const archiveBillingOffer = archiveBillingOfferOperation.send;

export const publishBillingOffer = publishBillingOfferOperation.send;

export const unpublishBillingOffer = unpublishBillingOfferOperation.send;

export const saveBillingPaymentOption = saveBillingPaymentOptionOperation.send;

export const archiveBillingPaymentOption =
  archiveBillingPaymentOptionOperation.send;

export const saveBillingPromotion = saveBillingPromotionOperation.send;

export const saveBillingCohort = saveBillingCohortOperation.send;

export const archiveBillingPromotion = archiveBillingPromotionOperation.send;

export const listBillingPayments = listBillingPaymentsOperation.send;

export async function readBillingPayment(
  input: ReadPaymentInput,
): Promise<BillingCommandResult<PaymentOutcome>> {
  const read = readBillingPaymentOperation.send;
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

export const reconcileBillingPayment = reconcileBillingPaymentOperation.send;

export const cancelOwnerSubscription = cancelOwnerSubscriptionOperation.send;

export const readBillingRefunds = readBillingRefundsOperation.send;

export const readAccessGrants = readAccessGrantsOperation.send;

export const readAccountClassification =
  readAccountClassificationOperation.send;

export const classifyAccount = classifyAccountOperation.send;

export const previewAccessGrantBatch = previewAccessGrantBatchOperation.send;

export const applyAccessGrantBatch = applyAccessGrantBatchOperation.send;

export const extendAccessGrant = extendAccessGrantOperation.send;

export const revokeAccessGrant = revokeAccessGrantOperation.send;

/** Re-read canonical prices and revisions after an acknowledged catalogue write. */
export function readOwnerBillingCatalog(): Promise<
  BillingCommandResult<PriceSnapshot[]>
> {
  return readBillingEndpoint(
    "/api/authoring/billing/catalog",
    ownerCatalogSchema,
  );
}
