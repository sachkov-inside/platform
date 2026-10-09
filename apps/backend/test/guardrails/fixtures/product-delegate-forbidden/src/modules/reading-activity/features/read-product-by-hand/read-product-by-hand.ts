// Product belongs to Materials, even when its delegate is carried by this transaction.
export async function readProductByHand(transaction: {
  product: { findUnique(input: unknown): Promise<unknown> };
}): Promise<unknown> {
  return transaction.product.findUnique({ where: { id: "product" } });
}
