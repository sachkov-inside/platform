import type {
  MaterialAssets,
  UploadMaterialAssetResult,
} from "../../../assets/index.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

export const MATERIAL_ASSET_AUTHORING = Symbol("MATERIAL_ASSET_AUTHORING");

export type UploadMaterialAssetForAuthoringResult =
  | UploadMaterialAssetResult
  | {
      readonly ok: false;
      readonly error: { readonly code: "forbidden" | "material_not_found" };
    };

export interface MaterialAssetAuthoring {
  upload(input: Parameters<MaterialAssets["upload"]>[0]): Promise<UploadMaterialAssetForAuthoringResult>;
}

export function assembleMaterialAssetAuthoring(dependencies: {
  readonly assets: MaterialAssets;
  readonly authoring: MaterialAuthoring;
}): MaterialAssetAuthoring {
  const authoring: MaterialAssetAuthoring = {
    async upload(input) {
      const material = await dependencies.authoring.loadMaterial({
        actor: input.actor,
        materialId: input.materialId,
      });
      if (!material.ok) {
        if (material.error.code === "forbidden" || material.error.code === "material_not_found") {
          return { error: { code: material.error.code }, ok: false };
        }
        throw new Error("Material ownership check is unavailable");
      }
      return dependencies.assets.upload(input);
    },
  };
  return Object.freeze(authoring);
}
