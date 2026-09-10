import {
  billingCommandPayload,
  billingCommandResult,
  offersPageSchema,
  purchaseStatusSchema,
  quoteSchema,
  type BillingCommandResult,
  type OffersPage,
  type PurchaseStatus,
  readBillingEndpoint,
  type BillingQuote,
} from "@/entities/subscription";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import type { PurchaseInput, QuoteInput } from "../model/checkout";

export function readBillingOffers(): Promise<
  BillingCommandResult<OffersPage>
> {
  return readBillingEndpoint("/api/billing/offers", offersPageSchema);
}

export async function createBillingQuote(
  input: QuoteInput,
): Promise<BillingCommandResult<BillingQuote>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/account/billing/quote",
      "POST",
      billingCommandPayload(input),
    ),
    quoteSchema,
  );
}

export async function startBillingPurchase(
  input: PurchaseInput,
): Promise<BillingCommandResult<PurchaseStatus>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/account/billing/purchase",
      "POST",
      billingCommandPayload(input),
    ),
    purchaseStatusSchema,
  );
}

export function readBillingPurchaseStatus(
  purchaseRef: string,
): Promise<BillingCommandResult<PurchaseStatus>> {
  return readBillingEndpoint(
    `/api/account/billing/purchase-status?purchaseRef=${encodeURIComponent(purchaseRef)}`,
    purchaseStatusSchema,
  );
}
