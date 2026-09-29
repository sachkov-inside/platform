// Reading Activity may hand its transaction to Materials, but must not read Material rows itself.
// The field of an ordinary value named like the delegate is not a delegate read.
export async function readMaterialByHand(
  transaction: { material: { findUnique(input: unknown): Promise<unknown> } },
  candidate: { material: { materialId: string } },
): Promise<unknown> {
  return transaction.material.findUnique({ where: { id: candidate.material.materialId } });
}
