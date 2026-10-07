import { internalRoute } from "@/shared/routing/internal-route";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loadViewerBillingOffers } from "@/entities/subscription.server";
import { requestPublishedMaterialCatalog } from "@/shared/api/backend/index.server";
import { subscriptionOfferParam } from "@/shared/routing/subscription-route";
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
  const [catalog, offers] = await Promise.all([
    requestPublishedMaterialCatalog({}),
    loadViewerBillingOffers(),
  ]);
  if (!catalog.ok || offers.kind === "unavailable")
    throw new Error("Checkout catalog unavailable");
  const products = catalogSchema.parse(catalog.body).facets.series;
  const slug = checkoutProductSlug(products, offers.offers, offerId);
  if (slug === undefined) redirect("/");
  const query = new URLSearchParams();
  if (offerId !== undefined) query.set("offer", offerId);
  for (const key of ["from", "promo"] as const) {
    const value = searchParams[key];
    if (typeof value === "string") query.set(key, value);
  }
  const search = query.toString();
  return redirect(
    internalRoute(
      `/products/${encodeURIComponent(slug)}/buy${search === "" ? "" : `?${search}`}`,
    ),
  );
}
