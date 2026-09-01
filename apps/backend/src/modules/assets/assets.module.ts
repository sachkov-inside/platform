import { Module } from "@nestjs/common";

import { PLATFORM_CONFIG, type PlatformConfig } from "../../config/platform-config.js";
import { createS3ObjectStorage, ensureS3Buckets, type ObjectStorage } from "../../infrastructure/object-storage/index.js";
import { PrismaClientProvider, PrismaModule } from "../../infrastructure/prisma/index.js";
import { assembleMaterialAssets } from "./facets/material-assets/assemble-material-assets.js";
import type { MaterialAssets } from "./facets/material-assets/material-assets.js";

export const MATERIAL_ASSETS = Symbol("MATERIAL_ASSETS");
export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: OBJECT_STORAGE,
      inject: [PLATFORM_CONFIG],
      useFactory: async (config: PlatformConfig): Promise<ObjectStorage> => {
        const storageConfig = {
          buckets: config.objectStorage.buckets,
          credentials: {
            accessKeyId: config.objectStorage.accessKeyId,
            secretAccessKey: config.objectStorage.secretAccessKey,
          },
          endpoint: config.objectStorage.endpoint,
          forcePathStyle: config.objectStorage.forcePathStyle,
          region: config.objectStorage.region,
        };
        if (config.mode === "development") await ensureS3Buckets(storageConfig);
        return createS3ObjectStorage(storageConfig);
      },
    },
    {
      provide: MATERIAL_ASSETS,
      inject: [PrismaClientProvider, OBJECT_STORAGE],
      useFactory: (
        prisma: PrismaClientProvider,
        objectStorage: ObjectStorage,
      ): MaterialAssets => assembleMaterialAssets({ objectStorage, prisma }),
    },
  ],
  exports: [MATERIAL_ASSETS, OBJECT_STORAGE],
})
export class AssetsModule {}
