import type { PriceSnapshot } from "@/entities/subscription";
export function checkoutProductSlug(
  products: readonly { readonly id: string; readonly slug: string }[],
  offers: readonly PriceSnapshot[],
  productId: string | undefined,
): string | undefined {
  const price = offers.find(
    (item) =>
      item.product !== undefined &&
      (productId === undefined || item.product.id === productId),
  );
  return products.find((item) => item.id === price?.product?.id)?.slug;
}
