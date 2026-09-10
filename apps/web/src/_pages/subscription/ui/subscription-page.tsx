import { loadBillingOffers } from "@/features/billing-checkout.server";
import type { SubscriptionRouteTarget } from "@/shared/routing/subscription-route";
import { SubscriptionStorefront } from "./subscription-storefront.client";

export async function SubscriptionPage({
  target,
}: {
  readonly target: SubscriptionRouteTarget;
}) {
  const result = await loadBillingOffers();
  return (
    <SubscriptionStorefront
      offers={result.kind === "ready" ? result.offers : []}
      {...(target.originHref === undefined
        ? {}
        : { originHref: target.originHref })}
      returnTo={target.returnTo}
      unavailable={result.kind === "unavailable"}
    />
  );
}
