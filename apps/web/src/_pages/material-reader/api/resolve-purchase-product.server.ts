import "server-only";
import { loadProductSaleAvailability } from "@/entities/subscription.sale.server";
import type { MaterialReaderMetadata } from "../model/material-reader-view";
import { soleSoldProduct } from "../model/purchase-product";
import { readReaderSeries } from "./read-reader-series.server";

export interface PurchaseProduct {
  readonly slug: string;
  readonly sold: boolean;
}

/** Explicit programme context wins; otherwise invite only to one admitted Product. */
export async function resolvePurchaseProduct(
  material: Pick<MaterialReaderMetadata, "seriesMemberships">,
  returnProductSlug: string | undefined,
  accessToken?: string,
): Promise<PurchaseProduct | undefined> {
  const memberships = material.seriesMemberships;
  if (returnProductSlug !== undefined) {
    let productId = memberships.find(({ series }) => series.slug === returnProductSlug)?.series.id;
    if (productId === undefined) {
      const product = await readReaderSeries(returnProductSlug, accessToken);
      productId = product.kind === "ready" || product.kind === "empty" ? product.reference.id : undefined;
    }
    if (productId === undefined) return { slug: returnProductSlug, sold: false };
    const availability = await loadProductSaleAvailability([productId], accessToken);
    return { slug: returnProductSlug, sold: availability.kind === "ready" && availability.soldProductIds.has(productId) };
  }
  const availability = await loadProductSaleAvailability(memberships.map(({ series }) => series.id), accessToken);
  if (availability.kind !== "ready") return undefined;
  const slug = soleSoldProduct(memberships.map(({ series }) => ({ slug: series.slug, sold: availability.soldProductIds.has(series.id) })));
  return slug === undefined ? undefined : { slug, sold: true };
}
