import type {
  AssetResourceFactsAdapter,
} from "../../../content-access/index.js";
import type { MaterialAssets } from "../../../assets/index.js";
import { materialId as checkedMaterialId } from "../../domain/material-identifiers.js";

export function assembleAssetResourceFacts(
  assets: Pick<MaterialAssets, "loadAccessFacts">,
): AssetResourceFactsAdapter {
  return {
    async findMany(assetIds) {
      const rows = await assets.loadAccessFacts(assetIds);
      if (!rows.ok) throw new Error(rows.error.code);
      return rows.value.map((row) => ({
        ...row,
        materialId: checkedMaterialId(row.materialId),
      }));
    },
    async findOne(assetId) {
      const rows = await assets.loadAccessFacts([assetId]);
      if (!rows.ok) throw new Error(rows.error.code);
      const [row] = rows.value;
      return row === undefined
        ? null
        : { ...row, materialId: checkedMaterialId(row.materialId) };
    },
  };
}
