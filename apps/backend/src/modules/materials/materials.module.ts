import { Module } from "@nestjs/common";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  ACCOUNTS,
  accountId as checkedAccountId,
  AccountsModule,
  type Accounts,
} from "../accounts/index.js";
import {
  assembleContentAccess,
  assembleCurrentAccountPermissions,
  CONTENT_ACCESS,
  type ContentAccess,
} from "../content-access/index.js";
import {
  MEMBERSHIP_ENTITLEMENTS,
  MembershipEntitlementsModule,
  type MembershipEntitlements,
} from "../membership-entitlements/index.js";
import { AssetsModule, MATERIAL_ASSETS, OBJECT_STORAGE, type MaterialAssets } from "../assets/index.js";
import type { ObjectStorage } from "../../infrastructure/object-storage/index.js";
import { assembleMaterialResourceFacts } from "./adapters/content-access/material-resource-facts.js";
import { assembleMaterialAuthoring } from "./facets/material-authoring/assemble-material-authoring.js";
import type { MaterialAuthoring } from "./facets/material-authoring/material-authoring.js";
import { MATERIAL_AUTHORING } from "./facets/material-authoring/material-authoring.token.js";
import type { AuthorPolicy } from "./ports/author-policy.js";
import {
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
} from "./facets/published-material-reader/published-material-reader.js";
import { assemblePublishedMaterialReader } from "./facets/published-material-reader/assemble-published-material-reader.js";
import { materialBodyOperations } from "./infrastructure/tiptap/index.js";
import {
  assembleMaterialContent,
  MATERIAL_CONTENT,
  type MaterialContent,
} from "./facets/material-content/material-content.js";
import {
  assembleMaterialAssetAuthoring,
  MATERIAL_ASSET_AUTHORING,
  type MaterialAssetAuthoring,
} from "./features/upload-material-asset/upload-material-asset.js";
import {
  assembleMaterialAssetDelivery,
  MATERIAL_ASSET_DELIVERY,
  type MaterialAssetDelivery,
} from "./features/deliver-material-asset/deliver-material-asset.js";
import { MaterialAssetCleanupScheduler } from "./adapters/nest/material-asset-cleanup.scheduler.js";

@Module({
  imports: [PrismaModule, AccountsModule, AssetsModule, MembershipEntitlementsModule],
  providers: [
    MaterialAssetCleanupScheduler,
    {
      provide: MATERIAL_AUTHORING,
      inject: [PrismaClientProvider, ACCOUNTS, CONTENT_ACCESS, MATERIAL_ASSETS],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        contentAccess: ContentAccess,
        materialAssets: MaterialAssets,
      ): MaterialAuthoring => {
        const accountPermissions = assembleCurrentAccountPermissions(accounts);
        const authorPolicy: AuthorPolicy = {
          canManage: (accountId) =>
            accountPermissions.hasMaterialsManage(checkedAccountId(accountId)),
        };
        return assembleMaterialAuthoring({
          prisma,
          authorPolicy,
          contentAccess,
          materialAssets,
          materialBodyOperations,
        });
      },
    },
    {
      provide: MATERIAL_CONTENT,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider): MaterialContent =>
        assembleMaterialContent({ prisma, materialBodyOperations }),
    },
    {
      provide: MATERIAL_ASSET_AUTHORING,
      inject: [MATERIAL_AUTHORING, MATERIAL_ASSETS],
      useFactory: (
        authoring: MaterialAuthoring,
        assets: MaterialAssets,
      ): MaterialAssetAuthoring => assembleMaterialAssetAuthoring({ assets, authoring }),
    },
    {
      provide: MATERIAL_ASSET_DELIVERY,
      inject: [MATERIAL_ASSETS, CONTENT_ACCESS, OBJECT_STORAGE, PLATFORM_CONFIG],
      useFactory: (
        assets: MaterialAssets,
        contentAccess: ContentAccess,
        objectStorage: ObjectStorage,
        config: PlatformConfig,
      ): MaterialAssetDelivery => assembleMaterialAssetDelivery({
        assets,
        contentAccess,
        objectStorage,
        signedGetTtlSeconds: config.objectStorage.signedGetTtlSeconds,
      }),
    },
    {
      provide: CONTENT_ACCESS,
      inject: [MATERIAL_CONTENT, ACCOUNTS, MEMBERSHIP_ENTITLEMENTS],
      useFactory: (
        materialContent: MaterialContent,
        accounts: Accounts,
        membershipEntitlements: MembershipEntitlements,
      ): ContentAccess =>
        assembleContentAccess({
          materialResourceFacts: assembleMaterialResourceFacts(materialContent),
          accountPermissions: assembleCurrentAccountPermissions(accounts),
          membershipEntitlements,
        }),
    },
    {
      provide: PUBLISHED_MATERIAL_READER,
      inject: [
        PrismaClientProvider,
        CONTENT_ACCESS,
        MATERIAL_CONTENT,
        PLATFORM_CONFIG,
        MATERIAL_ASSETS,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        contentAccess: ContentAccess,
        materialContent: MaterialContent,
        config: PlatformConfig,
        materialAssets: MaterialAssets,
      ): PublishedMaterialReader =>
        assemblePublishedMaterialReader({
          prisma,
          contentAccess,
          materialContent,
          materialBodyOperations,
          materialAssets,
          membershipAcquisitionUrl:
            config.contentAccess.membershipAcquisitionUrl,
        }),
    },
  ],
  exports: [
    CONTENT_ACCESS,
    MATERIAL_AUTHORING,
    MATERIAL_ASSET_AUTHORING,
    MATERIAL_ASSET_DELIVERY,
    PUBLISHED_MATERIAL_READER,
  ],
})
export class MaterialsModule {}
