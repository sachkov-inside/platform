// Reading Activity passes the same transaction to the Materials interface.
export async function readProduct(
  transaction: { product: { findUnique(input: unknown): Promise<unknown> } },
  materials: { readProduct(transaction: unknown): Promise<unknown> },
): Promise<unknown> {
  return materials.readProduct(transaction);
}
