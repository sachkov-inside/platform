import type { ProductMaterialReading } from "../ports/product-material-reading.js";
import type { TransactionHandle } from "../../../infrastructure/prisma/transaction-handle.js";
/** Adapts the Material owner's current publication projection to Product composition facts. */
export function compositionMaterialFacts(
  materials: ProductMaterialReading,
  handle?: TransactionHandle,
) {
  return {
    async load(ids: readonly string[]) {
      return (await materials.read({ ids }, handle)).map((material) => ({
        id: material.id,
        sourceId: material.sourceId,
        published: material.published !== null,
        topicId: material.topicId,
        hasModeVariants: material.hasModeVariants,
      }));
    },
  };
}
