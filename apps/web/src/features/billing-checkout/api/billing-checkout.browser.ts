import {
  billingCommandResult,
  billingReadResult,
  offersPageSchema,
  purchaseStatusSchema,
  quoteSchema,
  type BillingCommandResult,
  type OffersPage,
  type PurchaseStatus,
  type BillingQuote,
} from "@/entities/subscription";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import type { PurchaseInput, QuoteInput } from "../model/checkout";

function payload(input: unknown): FormData {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  return form;
}

export async function readBillingOffers(): Promise<
  BillingCommandResult<OffersPage>
> {
  try {
    const response = await fetch("/api/billing/offers", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    return await billingReadResult(response, offersPageSchema);
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export async function createBillingQuote(
  input: QuoteInput,
): Promise<BillingCommandResult<BillingQuote>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/account/billing/quote",
      "POST",
      payload(input),
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
      payload(input),
    ),
    purchaseStatusSchema,
  );
}

export async function readBillingPurchaseStatus(
  purchaseRef: string,
): Promise<BillingCommandResult<PurchaseStatus>> {
  try {
    const response = await fetch(
      `/api/account/billing/purchase-status?purchaseRef=${encodeURIComponent(purchaseRef)}`,
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      },
    );
    return await billingReadResult(response, purchaseStatusSchema);
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
