import type { PlatformConfig } from "../../../../config/platform-config.js";
import type { MaterialAssets } from "../../../assets/index.js";
import type { MaterialContent } from "../../facets/material-content/material-content.js";

export const MATERIAL_ASSET_MAINTENANCE = Symbol("MATERIAL_ASSET_MAINTENANCE");

export type CleanupMaterialAssetsResult =
  | Readonly<{ ok: true; cleaned: number; retained: number }>
  | Readonly<{
      ok: false;
      error: { code: "dependency_unavailable"; retryable: true };
    }>;

export interface MaterialAssetMaintenance {
  cleanup(): Promise<CleanupMaterialAssetsResult>;
}

export function assembleMaterialAssetMaintenance(dependencies: {
  readonly assets: Pick<MaterialAssets, "cleanupOrphans">;
  readonly config: Readonly<{
    objectStorage: Pick<PlatformConfig["objectStorage"], "orphanGraceMs">;
  }>;
  readonly materials: Pick<MaterialContent, "containsAssetReference">;
}): MaterialAssetMaintenance {
  return Object.freeze({
    async cleanup(): Promise<CleanupMaterialAssetsResult> {
      try {
        const result = await dependencies.assets.cleanupOrphans({
          graceMs: dependencies.config.objectStorage.orphanGraceMs,
          async isReferenced(input) {
            const reference = await dependencies.materials.containsAssetReference(input);
            if (!reference.ok) throw new Error(reference.error.code);
            return reference.value;
          },
        });
        return result.ok
          ? { ok: true, ...result.value }
          : result;
      } catch {
        return {
          error: { code: "dependency_unavailable", retryable: true },
          ok: false,
        };
      }
    },
  });
}
