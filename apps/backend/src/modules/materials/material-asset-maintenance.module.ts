import { Module } from "@nestjs/common";

import { PLATFORM_CONFIG, type PlatformConfig } from "../../config/platform-config.js";
import { PrismaClientProvider, PrismaModule } from "../../infrastructure/prisma/index.js";
import { AssetsModule, MATERIAL_ASSETS, type MaterialAssets } from "../assets/index.js";
import {
  assembleMaterialAssetMaintenance,
  MATERIAL_ASSET_MAINTENANCE,
  type MaterialAssetMaintenance,
} from "./features/cleanup-material-assets/cleanup-material-assets.js";
import {
  assembleMaterialContent,
  MATERIAL_CONTENT,
  type MaterialContent,
} from "./facets/material-content/material-content.js";
import { materialBodyOperations } from "./infrastructure/tiptap/index.js";

@Module({
  imports: [PrismaModule, AssetsModule],
  providers: [
    {
      provide: MATERIAL_CONTENT,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider): MaterialContent =>
        assembleMaterialContent({ prisma, materialBodyOperations }),
    },
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
