import { ProductsModule, ProductCoverSelection } from "../products/index.js";
import { routeContentCoverSelection } from "../content-covers/index.js";
import { MaterialCoverSelection } from "./infrastructure/postgres/material-cover-selection.js";
import { Module } from "@nestjs/common";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  OBJECT_STORAGE,
  ObjectStorageModule,
  type ObjectStorage,
} from "../../infrastructure/object-storage/index.js";
import { assembleContentCoverMaintenance } from "../content-covers/index.js";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  AssetsModule,
  MATERIAL_ASSETS,
  type MaterialAssets,
} from "../assets/index.js";
import {
  assembleMaterialAssetMaintenance,
  MATERIAL_ASSET_MAINTENANCE,
  type MaterialAssetMaintenance,
} from "./features/cleanup-material-assets/cleanup-material-assets.js";
import {
  MATERIAL_PUBLICATION,
  type MaterialContent,
} from "./facets/material-content/material-content.js";
import { MaterialContentModule } from "./material-content.module.js";

@Module({
  imports: [
    AssetsModule,
    ProductsModule,
    MaterialContentModule,
    PrismaModule,
    ObjectStorageModule,
  ],
  providers: [
    {
      provide: MATERIAL_ASSET_MAINTENANCE,
      inject: [
        MATERIAL_ASSETS,
        MATERIAL_PUBLICATION,
        PLATFORM_CONFIG,
        PrismaClientProvider,
        OBJECT_STORAGE,
        ProductCoverSelection,
      ],
      useFactory: (
        assets: MaterialAssets,
        materials: MaterialContent,
        config: PlatformConfig,
        prisma: PrismaClientProvider,
        objectStorage: ObjectStorage,
        products: ProductCoverSelection,
      ): MaterialAssetMaintenance =>
        assembleMaterialAssetMaintenance({
          assets,
          config,
          materials,
          covers: assembleContentCoverMaintenance({
            prisma,
            objectStorage,
            selection: routeContentCoverSelection({
              material: new MaterialCoverSelection(),
              topic: new MaterialCoverSelection(),
              product: products,
            }),
          }),
        }),
    },
  ],
  exports: [MATERIAL_ASSET_MAINTENANCE],
})
export class MaterialAssetMaintenanceModule {}
