import { internalRoute } from "@/shared/routing/internal-route";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loadBillingOffers } from "@/entities/subscription.server";
import { requestPublishedMaterialCatalog } from "@/shared/api/backend/index.server";
import { subscriptionOfferParam } from "@/shared/routing/subscription-route";
import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";
import { BillingSignIn } from "@/features/billing-subscription";
import { checkoutProductSlug } from "../model/checkout-product";

const catalogSchema = z.object({
  facets: z.object({
    series: z.array(z.object({ id: z.uuid(), slug: z.string().min(1) })),
  }),
});

/** Stable link for an Offer whose product slug is owned by the catalog, not Billing. */
export async function PaymentCheckoutRedirect({
  searchParams,
}: {
  readonly searchParams: {
    readonly offer?: string | readonly string[];
    readonly from?: string | readonly string[];
    readonly promo?: string | readonly string[];
  };
}) {
  const offerId = subscriptionOfferParam(searchParams.offer);
  const accessToken = await getOptionalPlatformAccessToken();
  const [catalog, offers] = await Promise.all([
    requestPublishedMaterialCatalog({}),
    loadBillingOffers({}, accessToken),
  ]);
  if (!catalog.ok || offers.kind === "unavailable")
    throw new Error("Checkout catalog unavailable");
  const products = catalogSchema.parse(catalog.body).facets.series;
  const slug = checkoutProductSlug(products, offers.offers, offerId);
  const query = new URLSearchParams();
  if (offerId !== undefined) query.set("offer", offerId);
  for (const key of ["from", "promo"] as const) {
    const value = searchParams[key];
    if (typeof value === "string") query.set(key, value);
  }
  const search = query.toString();
  if (
    offerId !== undefined &&
    !offers.offers.some((snapshot) => snapshot.offer.id === offerId)
  ) {
    // An invitation-only tariff is absent from the guest catalog. Resolve it after sign-in,
    // rather than moving its link to an unrelated product before identity is known.
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-12">
        {accessToken === undefined ? (
          <BillingSignIn
            description="Войдите, чтобы проверить доступ к выбранному тарифу и продолжить оформление."
            returnTo={internalRoute(`/payment/checkout?${search}`)}
          />
        ) : (
          <p role="status">Выбранный тариф сейчас недоступен для покупки.</p>
        )}
      </main>
    );
  }
  if (slug === undefined) redirect("/");
  return redirect(
    internalRoute(
      `/products/${encodeURIComponent(slug)}/buy${search === "" ? "" : `?${search}`}`,
    ),
  );
}
