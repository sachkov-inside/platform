import { publicSubscriptionOffers } from "@/entities/subscription";
import { loadBillingOffers } from "@/entities/subscription.server";

import { AccountSubscriptionView } from "./account-subscription-view.client";

export async function AccountSubscriptionPage() {
  const result = await loadBillingOffers();
  return (
    <AccountSubscriptionView
      options={publicSubscriptionOffers(
        result.kind === "ready" ? result.offers : [],
      )}
    />
  );
}
