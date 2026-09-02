import { Module } from "@nestjs/common";

import { PLATFORM_CONFIG, type PlatformConfig } from "../../config/platform-config.js";
import { AssetsModule, MATERIAL_ASSETS, type MaterialAssets } from "../assets/index.js";
import {
  assembleMaterialAssetMaintenance,
  MATERIAL_ASSET_MAINTENANCE,
  type MaterialAssetMaintenance,
} from "./features/cleanup-material-assets/cleanup-material-assets.js";
import { MATERIAL_CONTENT, type MaterialContent } from "./facets/material-content/material-content.js";
import { MaterialContentModule } from "./material-content.module.js";

@Module({
  imports: [AssetsModule, MaterialContentModule],
  providers: [
    {
      provide: MATERIAL_ASSET_MAINTENANCE,
      inject: [MATERIAL_ASSETS, MATERIAL_CONTENT, PLATFORM_CONFIG],
      useFactory: (
        assets: MaterialAssets,
        materials: MaterialContent,
        config: PlatformConfig,
      ): MaterialAssetMaintenance =>
        assembleMaterialAssetMaintenance({ assets, config, materials }),
    },
  ],
  exports: [MATERIAL_ASSET_MAINTENANCE],
})
export class MaterialAssetMaintenanceModule {}
