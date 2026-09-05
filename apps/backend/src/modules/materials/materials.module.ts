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
import { AssetsModule, MATERIAL_ASSETS, type MaterialAssets } from "../assets/index.js";
import {
  OBJECT_STORAGE,
  ObjectStorageModule,
  type ObjectStorage,
} from "../../infrastructure/object-storage/index.js";
import { VIDEOS, VideosModule, type Videos } from "../videos/index.js";
import { assembleMaterialResourceFacts } from "./adapters/content-access/material-resource-facts.js";
import { assembleAssetResourceFacts } from "./adapters/content-access/asset-resource-facts.js";
import { assembleVideoResourceFacts } from "./adapters/content-access/video-resource-facts.js";
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
import {
  assembleVideoPlayback,
  VIDEO_PLAYBACK,
  type VideoPlayback,
} from "./facets/video-playback/video-playback.js";
import { MaterialContentModule } from "./material-content.module.js";
import {
  WORKSHOP_MATERIAL_ACCESS,
  WORKSHOP_MATERIAL_PROTECTION,
  WorkshopModule,
  type WorkshopMaterialAccess,
  type WorkshopMaterialProtection,
} from "../workshop/index.js";
import {
  assembleContentCovers,
  CONTENT_COVERS,
  type ContentCovers,
} from "./facets/content-covers/content-covers.js";

@Module({
  imports: [
    PrismaModule,
    ObjectStorageModule,
    AccountsModule,
    AssetsModule,
    MaterialContentModule,
    MembershipEntitlementsModule,
    VideosModule,
    WorkshopModule,
  ],
  providers: [
    {
      provide: MATERIAL_AUTHORING,
      inject: [
        PrismaClientProvider,
        ACCOUNTS,
        CONTENT_ACCESS,
        MATERIAL_ASSETS,
        VIDEOS,
        WORKSHOP_MATERIAL_PROTECTION,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        contentAccess: ContentAccess,
        materialAssets: MaterialAssets,
        videos: Videos,
        workshopMaterialProtection: WorkshopMaterialProtection,
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
          videos,
          workshopMaterialProtection,
          materialBodyOperations,
        });
      },
    },
    {
      provide: CONTENT_COVERS,
      inject: [PrismaClientProvider, ACCOUNTS, OBJECT_STORAGE],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        objectStorage: ObjectStorage,
      ): ContentCovers => {
        const accountPermissions = assembleCurrentAccountPermissions(accounts);
        return assembleContentCovers({
          prisma,
          objectStorage,
          authorPolicy: {
            canManage: (accountId) =>
              accountPermissions.hasMaterialsManage(checkedAccountId(accountId)),
          },
        });
      },
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
      inject: [
        MATERIAL_ASSETS,
        CONTENT_ACCESS,
        MATERIAL_CONTENT,
        OBJECT_STORAGE,
        PLATFORM_CONFIG,
      ],
      useFactory: (
        assets: MaterialAssets,
        contentAccess: ContentAccess,
        materialContent: MaterialContent,
        objectStorage: ObjectStorage,
        config: PlatformConfig,
      ): MaterialAssetDelivery => assembleMaterialAssetDelivery({
        assets,
        contentAccess,
        materialContent,
        objectStorage,
        signedGetTtlSeconds: config.objectStorage.signedGetTtlSeconds,
      }),
    },
    {
      provide: CONTENT_ACCESS,
      inject: [
        MATERIAL_CONTENT,
        MATERIAL_ASSETS,
        VIDEOS,
        ACCOUNTS,
        MEMBERSHIP_ENTITLEMENTS,
        WORKSHOP_MATERIAL_ACCESS,
      ],
      useFactory: (
        materialContent: MaterialContent,
        materialAssets: MaterialAssets,
        videos: Videos,
        accounts: Accounts,
        membershipEntitlements: MembershipEntitlements,
        workshopMaterialAccess: WorkshopMaterialAccess,
      ): ContentAccess =>
        assembleContentAccess({
          assetResourceFacts: assembleAssetResourceFacts(materialAssets),
          videoResourceFacts: assembleVideoResourceFacts(videos),
          materialResourceFacts: assembleMaterialResourceFacts(materialContent),
          accountPermissions: assembleCurrentAccountPermissions(accounts),
          membershipEntitlements,
          workshopMaterialAccess,
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
        VIDEOS,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        contentAccess: ContentAccess,
        materialContent: MaterialContent,
        config: PlatformConfig,
        materialAssets: MaterialAssets,
        videos: Videos,
      ): PublishedMaterialReader =>
        assemblePublishedMaterialReader({
          prisma,
          contentAccess,
          materialContent,
          materialBodyOperations,
          materialAssets,
          videos,
          membershipAcquisitionUrl:
            config.contentAccess.membershipAcquisitionUrl,
        }),
    },
    {
      provide: VIDEO_PLAYBACK,
      inject: [CONTENT_ACCESS, VIDEOS, PLATFORM_CONFIG],
      useFactory: (
        contentAccess: ContentAccess,
        videos: Videos,
        config: PlatformConfig,
      ): VideoPlayback => assembleVideoPlayback({
        contentAccess,
        jwtSecret: config.kinescope.playbackJwtSecret,
        jwtTtlSeconds: config.kinescope.playbackJwtTtlSeconds,
        videos,
      }),
    },
  ],
  exports: [
    CONTENT_ACCESS,
    CONTENT_COVERS,
    MATERIAL_AUTHORING,
    MATERIAL_ASSET_AUTHORING,
    MATERIAL_ASSET_DELIVERY,
    PUBLISHED_MATERIAL_READER,
    VIDEO_PLAYBACK,
  ],
})
export class MaterialsModule {}
