import { Module } from "@nestjs/common";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import { createS3ObjectStorage, ensureS3Buckets } from "./s3-object-storage.js";
import type { ObjectStorage } from "./object-storage.js";

export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

@Module({
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
  ],
  exports: [OBJECT_STORAGE],
})
export class ObjectStorageModule {}
