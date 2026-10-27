import type { MaterialContent } from "../../modules/materials/index.js";
import type { ProductCatalogue } from "../../modules/products/index.js";

/** Cross-owner access facts are assembled above their publication and catalogue owners. */
export function composeMaterialAccessFacts(
  materials: MaterialContent,
  products: Pick<ProductCatalogue, "materialAccessFacts">,
): MaterialContent {
  const source: MaterialContent = {
    ...materials,
    async findAccessFacts(materialId, handle) {
      const result = await materials.findAccessFacts(materialId, handle);
      if (!result.ok || result.value === null) return result;
      const catalogue = await products.materialAccessFacts(
        [materialId],
        handle,
      );
      return {
        ok: true as const,
        value: { ...result.value, ...catalogue.get(materialId) },
      };
    },
    async findAccessFactsMany(materialIds) {
      const result = await materials.findAccessFactsMany(materialIds);
      if (!result.ok) return result;
      const catalogue = await products.materialAccessFacts(materialIds);
      return {
        ok: true as const,
        value: result.value.map((fact) => ({
          ...fact,
          ...catalogue.get(fact.materialId),
        })),
      };
    },
  };
  return Object.freeze(source);
}
