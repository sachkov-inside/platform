/** Canonical purchase provenance used by ProductAccess fulfillment and diagnostics. */
export function paidGrantSourceRef(
  purchaseRef: string,
  productId: string,
  productCount: number,
): string {
  return productCount === 1
    ? `payment:${purchaseRef}`
    : `payment:${purchaseRef}:product:${productId}`;
}
