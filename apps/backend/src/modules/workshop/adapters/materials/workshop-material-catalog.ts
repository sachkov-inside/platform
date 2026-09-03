import { materialId, type MaterialContent } from "../../../materials/index.js";
import type { WorkshopMaterialCatalog } from "../../ports/workshop-material-catalog.js";

export function assembleWorkshopMaterialCatalog(
  materialContent: Pick<MaterialContent, "findAccessFactsMany">,
): WorkshopMaterialCatalog {
  const catalog: WorkshopMaterialCatalog = {
    async findMany(materialIds) {
      const result = await materialContent.findAccessFactsMany(
        materialIds.map(materialId),
      );
      if (!result.ok) throw new Error(result.error.code);
      return result.value.map(({ access, materialId, publicationState }) => ({
        access,
        materialId,
        publicationState,
      }));
    },
  };
  return Object.freeze(catalog);
}
