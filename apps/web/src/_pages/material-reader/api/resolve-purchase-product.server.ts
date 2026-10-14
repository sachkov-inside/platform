import "server-only";
import { loadProductSaleAvailability } from "@/entities/subscription.availability.server";
import type { MaterialReaderMetadata } from "../model/material-reader-view";
import { soleSoldProduct } from "../model/purchase-product";
import { readReaderSeries } from "./read-reader-series.server";

export type PurchaseProductResult =
  | { readonly kind: "ready"; readonly product: PurchaseProduct | undefined }
  | { readonly kind: "unavailable" };

export interface PurchaseProduct {
  readonly slug: string;
  readonly sold: boolean;
}

/** Explicit programme context wins; otherwise invite only to one admitted Product. */
export async function resolvePurchaseProduct(
  material: Pick<MaterialReaderMetadata, "seriesMemberships">,
  returnProductSlug: string | undefined,
  accessToken?: string,
): Promise<PurchaseProductResult> {
  const memberships = material.seriesMemberships;
  if (returnProductSlug !== undefined) {
    const membership = memberships.find(
      ({ series }) => series.slug === returnProductSlug,
    );
    let productId = membership?.series.id;
    if (membership !== undefined && productId === undefined)
      return { kind: "unavailable" };
    if (membership === undefined) {
      const product = await readReaderSeries(returnProductSlug, accessToken);
      if (product.kind === "unavailable") return { kind: "unavailable" };
      productId =
        product.kind === "ready" || product.kind === "empty"
          ? product.reference.id
          : undefined;
    }
    if (productId === undefined)
      return {
        kind: "ready",
        product: { slug: returnProductSlug, sold: false },
      };
    const availability = await loadProductSaleAvailability(
      [productId],
      accessToken,
    );
    if (availability.kind !== "ready") return { kind: "unavailable" };
    return {
      kind: "ready",
      product: {
        slug: returnProductSlug,
        sold: availability.soldProductIds.has(productId.toLowerCase()),
      },
    };
  }
  const availability = await loadProductSaleAvailability(
    memberships.map(({ series }) => series.id),
    accessToken,
  );
  if (availability.kind !== "ready") return { kind: "unavailable" };
  const slug = soleSoldProduct(
    memberships.map(({ series }) => ({
      slug: series.slug,
      sold: availability.soldProductIds.has(series.id.toLowerCase()),
    })),
  );
  return {
    kind: "ready",
    product: slug === undefined ? undefined : { slug, sold: true },
  };
}
