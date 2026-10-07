import { loadViewerBillingOffers } from "@/entities/subscription.server";
import type { SubscriptionRouteTarget } from "@/shared/routing/subscription-route";
import { SubscriptionStorefront } from "./subscription-storefront.client";

export async function SubscriptionPage({
  target,
}: {
  readonly target: SubscriptionRouteTarget;
}) {
  const result = await loadViewerBillingOffers({ mode: "subscription" });
  return (
    <SubscriptionStorefront
      offers={result.kind === "ready" ? result.offers : []}
      {...(target.originHref === undefined
        ? {}
        : { originHref: target.originHref })}
      {...(target.offerId === undefined
        ? {}
        : { initialOfferId: target.offerId })}
      returnTo={target.returnTo}
      unavailable={result.kind === "unavailable"}
    />
  );
}
