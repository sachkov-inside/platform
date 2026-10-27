// Product belongs to Products; callers pass an opaque handle instead of carrying foreign delegates.
export async function readProductByHand(transaction: {
  product: { findUnique(input: unknown): Promise<unknown> };
}): Promise<unknown> {
  return transaction.product.findUnique({ where: { id: "product" } });
}
