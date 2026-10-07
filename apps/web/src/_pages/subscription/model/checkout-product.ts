import { tariffCoverage } from "@inside/access-capabilities";
import type { PriceSnapshot } from "@/entities/subscription";

/** A whole-platform tariff opens checkout through any published product in its coverage. */
export function checkoutProductSlug(
  products: readonly { readonly id: string; readonly slug: string }[],
  offers: readonly PriceSnapshot[],
  offerId: string | undefined,
): string | undefined {
  const offer = offers.find((item) => item.offer.id === offerId)?.offer;
  if (offer === undefined) return products[0]?.slug;
  const coverage = tariffCoverage(
    offer.benefits,
    offer.coverage ?? { productIds: [], materialIds: [] },
  );
  return products.find(
    (product) =>
      coverage.wholePlatform === true ||
      coverage.productIds.includes(product.id),
  )?.slug;
}
