import { Module } from "@nestjs/common";
import { AccountsModule, ACCOUNTS, type Accounts } from "../accounts/index.js";
import {
  PrismaModule,
  PrismaClientProvider,
} from "../../infrastructure/prisma/index.js";
import {
  ObjectStorageModule,
  OBJECT_STORAGE,
  type ObjectStorage,
} from "../../infrastructure/object-storage/index.js";
import { CONTENT_ACCESS, type ContentAccess } from "../content-access/index.js";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PRODUCT_MATERIALS,
  type ProductMaterials,
} from "./ports/product-materials.js";
import { assembleProductArtifacts } from "./facets/product-artifacts/assemble-product-artifacts.js";
import {
  PRODUCT_ARTIFACTS,
  type ProductArtifacts,
} from "./facets/product-artifacts/product-artifacts.js";
import {
  PRODUCT_ARTIFACT_DELIVERY,
  assembleProductArtifactDelivery,
  type ProductArtifactDelivery,
} from "./features/deliver-product-artifact/deliver-product-artifact.js";

@Module({
  imports: [AccountsModule, PrismaModule, ObjectStorageModule],
  providers: [
    {
      provide: PRODUCT_ARTIFACTS,
      inject: [
        PrismaClientProvider,
        ACCOUNTS,
        OBJECT_STORAGE,
        PRODUCT_MATERIALS,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        objectStorage: ObjectStorage,
        materials: ProductMaterials,
      ): ProductArtifacts =>
        assembleProductArtifacts({
          prisma,
          objectStorage,
          materials,
          authorPolicy: {
            canManage: async (accountId, transaction) => {
              const decision = await accounts.checkPermission(
                { accountId, permission: "materials:manage" },
                transaction,
              );
              if (!decision.ok)
                throw new Error("Account permission unavailable");
              return decision.allowed;
            },
          },
        }),
    },
    {
      provide: PRODUCT_ARTIFACT_DELIVERY,
      inject: [
        PRODUCT_ARTIFACTS,
        CONTENT_ACCESS,
        OBJECT_STORAGE,
        PLATFORM_CONFIG,
      ],
      useFactory: (
        artifacts: ProductArtifacts,
        contentAccess: ContentAccess,
        objectStorage: ObjectStorage,
        config: PlatformConfig,
      ): ProductArtifactDelivery =>
        assembleProductArtifactDelivery({
          artifacts,
          contentAccess,
          objectStorage,
          signedGetTtlSeconds: config.objectStorage.signedGetTtlSeconds,
        }),
    },
  ],
  exports: [PRODUCT_ARTIFACTS, PRODUCT_ARTIFACT_DELIVERY],
})
export class ProductArtifactsModule {}
