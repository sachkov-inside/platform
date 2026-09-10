import { loadBillingOffers } from "@/features/billing-checkout.server";

import { BillingAccountView } from "./billing-account-view.client";

export async function BillingAccountPage() {
  const result = await loadBillingOffers();
  return (
    <BillingAccountView
      options={result.kind === "ready" ? result.offers : []}
    />
  );
}
