import type { MaterialResourceFactsAdapter } from "../../../content-access/index.js";
import type { MaterialId } from "../../domain/material-identifiers.js";
import type { MaterialContent } from "../../facets/material-content/material-content.js";

export function assembleMaterialResourceFacts(
  materialContent: MaterialContent,
): MaterialResourceFactsAdapter {
  return Object.freeze({
    async findMany(materialIds: readonly MaterialId[]) {
      const result = await materialContent.findAccessFactsMany(materialIds);
      if (!result.ok) {
        throw new Error(`Material facts read failed: ${result.error.code}`);
      }
      return result.value;
    },
    async findOne(materialId: MaterialId) {
      const result = await materialContent.findAccessFacts(materialId);
      if (!result.ok) {
        throw new Error(`Material facts read failed: ${result.error.code}`);
      }
      return result.value;
    },
  });
}
