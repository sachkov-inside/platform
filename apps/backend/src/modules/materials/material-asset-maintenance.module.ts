import { Module } from "@nestjs/common";
import { PrismaClientProvider, PrismaModule } from "../../infrastructure/prisma/index.js";
import { OBJECT_STORAGE, ObjectStorageModule, type ObjectStorage } from "../../infrastructure/object-storage/index.js";
import { assembleContentCoverMaintenance } from "./features/cleanup-content-covers/cleanup-content-covers.js";

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
  imports: [AssetsModule, MaterialContentModule, PrismaModule, ObjectStorageModule],
  providers: [
    {
      provide: MATERIAL_ASSET_MAINTENANCE,
      inject: [MATERIAL_ASSETS, MATERIAL_CONTENT, PLATFORM_CONFIG, PrismaClientProvider, OBJECT_STORAGE],
      useFactory: (
        assets: MaterialAssets,
        materials: MaterialContent,
        config: PlatformConfig,
        prisma: PrismaClientProvider,
        objectStorage: ObjectStorage,
      ): MaterialAssetMaintenance =>
        assembleMaterialAssetMaintenance({
          assets, config, materials,
          covers: assembleContentCoverMaintenance({ prisma, objectStorage }),
        }),
    },
  ],
  exports: [MATERIAL_ASSET_MAINTENANCE],
})
export class MaterialAssetMaintenanceModule {}
