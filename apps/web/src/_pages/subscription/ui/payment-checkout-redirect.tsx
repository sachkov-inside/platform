import { internalRoute } from "@/shared/routing/internal-route";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loadBillingOffers } from "@/entities/subscription.server";
import { requestPublishedMaterialCatalog } from "@/shared/api/backend/index.server";
import { subscriptionOfferParam } from "@/shared/routing/subscription-route";
import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";
import { PaymentCheckoutUnavailable } from "./payment-checkout-unavailable";
import { checkoutProductSlug } from "../model/checkout-product";

const catalogSchema = z.object({
  facets: z.object({
    products: z.array(z.object({ id: z.uuid(), slug: z.string().min(1) })),
  }),
});

/** Product identity resolves through the owning catalogue. */
export async function PaymentCheckoutRedirect({
  searchParams,
}: {
  readonly searchParams: {
    readonly productId?: string | readonly string[];
    readonly from?: string | readonly string[];
    readonly promo?: string | readonly string[];
  };
}) {
  const productId = subscriptionOfferParam(searchParams.productId);
  const accessToken = await getOptionalPlatformAccessToken();
  const [catalog, offers] = await Promise.all([
    requestPublishedMaterialCatalog({}),
    loadBillingOffers({}, accessToken),
  ]);
  if (!catalog.ok || offers.kind === "unavailable")
    throw new Error("Checkout catalog unavailable");
  const products = catalogSchema.parse(catalog.body).facets.products;
  const slug = checkoutProductSlug(products, offers.offers, productId);
  const query = new URLSearchParams();
  if (productId !== undefined) query.set("productId", productId);
  for (const key of ["from", "promo"] as const) {
    const value = searchParams[key];
    if (typeof value === "string") query.set(key, value);
  }
  const search = query.toString();
  if (
    productId !== undefined &&
    !offers.offers.some((snapshot) => snapshot.product?.id === productId)
  ) {
    return (
      <PaymentCheckoutUnavailable
        viewer={accessToken === undefined ? "guest" : "member"}
        returnTo={internalRoute(`/payment/checkout?${search}`)}
      />
    );
  }
  if (slug === undefined) redirect("/");
  return redirect(
    internalRoute(
      `/products/${encodeURIComponent(slug)}/buy${search === "" ? "" : `?${search}`}`,
    ),
  );
}
