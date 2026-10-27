import {
  ProductCompositionsReading,
  ProductReadingModule,
} from "../products/index.js";
import {
  PRODUCT_MEMBERSHIPS,
  type ProductMemberships,
} from "../products/index.js";
import { PRODUCT_AUTHORING, type ProductAuthoring } from "../products/index.js";
import {
  ProductDiscovery,
  ProductsModule,
  ProductCoverSelection,
} from "../products/index.js";
import { routeContentCoverSelection } from "../content-covers/index.js";
import { MaterialCoverSelection } from "./infrastructure/postgres/material-cover-selection.js";
import {
  PRODUCT_ACCESS_HOLDERS,
  type ProductAccessHolders,
} from "./ports/product-access-holders.js";
import { PRODUCT_SALE_AVAILABILITY } from "./ports/product-sale-availability.js";
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
import { CONTENT_ACCESS, type ContentAccess } from "../content-access/index.js";
import {
  AssetsModule,
  MATERIAL_ASSETS,
  type MaterialAssets,
} from "../assets/index.js";
import {
  OBJECT_STORAGE,
  ObjectStorageModule,
  type ObjectStorage,
} from "../../infrastructure/object-storage/index.js";
import { VIDEOS, VideosModule, type Videos } from "../videos/index.js";
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
  assembleContentCovers,
  CONTENT_COVERS,
  type ContentCovers,
} from "../content-covers/index.js";
import { MaterialAnnouncements } from "./facets/material-announcements/material-announcements.js";

@Module({
  imports: [
    PrismaModule,
    ProductsModule,
    ProductReadingModule,
    ObjectStorageModule,
    AccountsModule,
    AssetsModule,
    MaterialContentModule,
    VideosModule,
  ],
  providers: [
    {
      provide: MATERIAL_AUTHORING,
      inject: [
        PrismaClientProvider,
        PRODUCT_AUTHORING,
        ProductDiscovery,
        PRODUCT_MEMBERSHIPS,
        ACCOUNTS,
        CONTENT_ACCESS,
        MATERIAL_ASSETS,
        VIDEOS,
        PRODUCT_ACCESS_HOLDERS,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        products: ProductAuthoring,
        discovery: ProductDiscovery,
        memberships: ProductMemberships,
        accounts: Accounts,
        contentAccess: ContentAccess,
        materialAssets: MaterialAssets,
        videos: Videos,
        grants: ProductAccessHolders,
      ): MaterialAuthoring => {
        const authorPolicy: AuthorPolicy = {
          async canManage(accountId, handle) {
            const decision = await accounts.checkPermission(
              { accountId, permission: "materials:manage" },
              handle,
            );
            return decision.ok && decision.allowed;
          },
        };
        return assembleMaterialAuthoring({
          prisma,
          products,
          discovery,
          memberships,
          authorPolicy,
          contentAccess,
          materialAssets,
          videos,
          materialBodyOperations,
          productAccessHolders: grants,
        });
      },
    },
    {
      provide: MaterialAnnouncements,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider): MaterialAnnouncements =>
        new MaterialAnnouncements({ prisma }),
    },
    {
      provide: CONTENT_COVERS,
      inject: [
        PrismaClientProvider,
        ACCOUNTS,
        OBJECT_STORAGE,
        ProductCoverSelection,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        objectStorage: ObjectStorage,
        products: ProductCoverSelection,
      ): ContentCovers => {
        const materials = new MaterialCoverSelection();
        return assembleContentCovers({
          selection: routeContentCoverSelection({
            material: materials,
            topic: materials,
            product: products,
          }),
          prisma,
          objectStorage,
          authorPolicy: {
            canManage: async (accountId, transaction) => {
              const permission = await accounts.checkPermission(
                {
                  accountId: checkedAccountId(accountId),
                  permission: "materials:manage",
                },
                transaction,
              );
              if (!permission.ok)
                throw new Error("Account permission unavailable");
              return permission.allowed;
            },
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
      ): MaterialAssetAuthoring =>
        assembleMaterialAssetAuthoring({ assets, authoring }),
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
      ): MaterialAssetDelivery =>
        assembleMaterialAssetDelivery({
          assets,
          contentAccess,
          materialContent,
          objectStorage,
          signedGetTtlSeconds: config.objectStorage.signedGetTtlSeconds,
        }),
    },
    {
      provide: PUBLISHED_MATERIAL_READER,
      inject: [
        PrismaClientProvider,
        ProductDiscovery,
        ProductCompositionsReading,
        CONTENT_ACCESS,
        MATERIAL_CONTENT,
        MATERIAL_ASSETS,
        VIDEOS,
        PRODUCT_SALE_AVAILABILITY,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        products: ProductDiscovery,
        compositions: ProductCompositionsReading,
        contentAccess: ContentAccess,
        materialContent: MaterialContent,
        materialAssets: MaterialAssets,
        videos: Videos,
        subscriptionForSale: (accountId?: string) => Promise<boolean>,
      ): PublishedMaterialReader =>
        assemblePublishedMaterialReader({
          prisma,
          products,
          compositions,
          contentAccess,
          materialContent,
          materialBodyOperations,
          materialAssets,
          videos,
          subscriptionForSale,
        }),
    },
    {
      provide: VIDEO_PLAYBACK,
      inject: [CONTENT_ACCESS, VIDEOS, PLATFORM_CONFIG],
      useFactory: (
        contentAccess: ContentAccess,
        videos: Videos,
        config: PlatformConfig,
      ): VideoPlayback =>
        assembleVideoPlayback({
          contentAccess,
          jwtSecret: config.kinescope.playbackJwtSecret,
          jwtTtlSeconds: config.kinescope.playbackJwtTtlSeconds,
          videos,
        }),
    },
  ],
  exports: [
    CONTENT_COVERS,
    MaterialAnnouncements,
    MATERIAL_AUTHORING,
    MATERIAL_ASSET_AUTHORING,
    MATERIAL_ASSET_DELIVERY,
    PUBLISHED_MATERIAL_READER,
    VIDEO_PLAYBACK,
  ],
})
export class MaterialsModule {}
