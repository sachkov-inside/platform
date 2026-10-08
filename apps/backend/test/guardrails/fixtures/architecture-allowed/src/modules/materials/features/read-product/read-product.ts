// Materials owns the Product delegate.
export async function readProduct(transaction: {
  product: { findUnique(input: unknown): Promise<unknown> };
}): Promise<unknown> {
  return transaction.product.findUnique({ where: { id: "product" } });
}
