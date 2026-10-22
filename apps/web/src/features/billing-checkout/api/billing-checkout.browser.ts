import {
  createBillingQuoteOperation,
  startBillingPurchaseOperation,
} from "./billing-checkout.operation";
import {
  purchaseStatusSchema,
  type BillingCommandResult,
  type PurchaseStatus,
  readBillingEndpoint,
} from "@/entities/subscription";

export const createBillingQuote = createBillingQuoteOperation.send;

export const startBillingPurchase = startBillingPurchaseOperation.send;

export function readBillingPurchaseStatus(
  purchaseRef: string,
): Promise<BillingCommandResult<PurchaseStatus>> {
  return readBillingEndpoint(
    `/api/account/billing/purchase-status?purchaseRef=${encodeURIComponent(purchaseRef)}`,
    purchaseStatusSchema,
  );
}

export function restoreProductPurchase(
  productId: string,
  purchaseRef?: string,
): Promise<BillingCommandResult<PurchaseStatus | null>> {
  return readBillingEndpoint(
    `/api/account/billing/product-purchase?productId=${encodeURIComponent(productId)}${purchaseRef === undefined ? "" : `&purchaseRef=${encodeURIComponent(purchaseRef)}`}`,
    purchaseStatusSchema.nullable(),
  );
}
