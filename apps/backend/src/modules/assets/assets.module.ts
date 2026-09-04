import { Module } from "@nestjs/common";

import {
  OBJECT_STORAGE,
  ObjectStorageModule,
  type ObjectStorage,
} from "../../infrastructure/object-storage/index.js";
import { PrismaClientProvider, PrismaModule } from "../../infrastructure/prisma/index.js";
import { assembleMaterialAssets } from "./facets/material-assets/assemble-material-assets.js";
import type { MaterialAssets } from "./facets/material-assets/material-assets.js";

export const MATERIAL_ASSETS = Symbol("MATERIAL_ASSETS");
@Module({
  imports: [PrismaModule, ObjectStorageModule],
  providers: [
    {
      provide: MATERIAL_ASSETS,
      inject: [PrismaClientProvider, OBJECT_STORAGE],
      useFactory: (
        prisma: PrismaClientProvider,
        objectStorage: ObjectStorage,
      ): MaterialAssets => assembleMaterialAssets({ objectStorage, prisma }),
    },
  ],
  exports: [MATERIAL_ASSETS],
})
export class AssetsModule {}
