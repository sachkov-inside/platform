import { PRODUCT_MATERIAL_READING } from "../../modules/products/index.js";
import { assembleProductMaterialReading } from "../../modules/materials/index.js";
import {
  ProductDiscovery,
  ProductsModule,
} from "../../modules/products/index.js";
import {
  ProductArtifactsModule,
  PRODUCT_MATERIALS,
} from "../../modules/products/index.js";
import { assembleProductMaterials } from "../../modules/materials/index.js";
import {
  PrismaModule,
  PrismaClientProvider,
} from "../../infrastructure/prisma/index.js";
import { Global, Module } from "@nestjs/common";
import {
  ACCOUNTS,
  AccountsModule,
  type Accounts,
} from "../../modules/accounts/index.js";
import {
  ACCESS_GRANTS,
  ACCOUNT_RIGHTS,
  AccountRightsModule,
  type AccountRights,
} from "../../modules/account-rights/index.js";
import { BillingModule, BillingPricing } from "../../modules/billing/index.js";
import {
  MATERIAL_ASSETS,
  AssetsModule,
  type MaterialAssets,
} from "../../modules/assets/index.js";
import {
  VIDEOS,
  VideosModule,
  type Videos,
} from "../../modules/videos/index.js";
import {
  assembleContentAccess,
  assembleCurrentAccountPermissions,
  CONTENT_ACCESS,
  PRODUCT_TASK_RESOURCE_FACTS,
  type ContentAccess,
  type ProductTaskResourceFactsAdapter,
} from "../../modules/content-access/index.js";
import { ProductTaskResourceFactsModule } from "../../modules/product-tasks/index.js";
import {
  PRODUCT_ARTIFACTS,
  assembleProductArtifactResourceFacts,
  type ProductArtifacts,
} from "../../modules/products/index.js";
import {
  MaterialsModule,
  MaterialContentModule,
  MATERIAL_CONTENT,
  PRODUCT_ACCESS_HOLDERS,
  PRODUCT_SALE_AVAILABILITY,
  assembleAssetResourceFacts,
  assembleVideoResourceFacts,
  assembleMaterialResourceFacts,
  type MaterialContent,
} from "../../modules/materials/index.js";

/** Process composition owns access policy wiring above the independent content owners. */
@Global()
@Module({
  imports: [
    PrismaModule,
    ProductArtifactsModule,
    AccountsModule,
    ProductsModule,
    AccountRightsModule,
    BillingModule,
    AssetsModule,
    VideosModule,
    MaterialsModule,
    MaterialContentModule,
    ProductTaskResourceFactsModule,
  ],
  providers: [
    {
      provide: PRODUCT_MATERIAL_READING,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        assembleProductMaterialReading(prisma),
    },
    {
      provide: PRODUCT_MATERIALS,
      inject: [PrismaClientProvider, ProductDiscovery],
      useFactory: (prisma: PrismaClientProvider, discovery: ProductDiscovery) =>
        assembleProductMaterials(prisma, discovery),
    },
    { provide: PRODUCT_ACCESS_HOLDERS, useExisting: ACCESS_GRANTS },
    {
      provide: PRODUCT_SALE_AVAILABILITY,
      inject: [BillingPricing],
      useFactory: (pricing: BillingPricing) => (accountId?: string) =>
        pricing.hasOffersForSale(accountId),
    },
    {
      provide: CONTENT_ACCESS,
      inject: [
        MATERIAL_CONTENT,
        MATERIAL_ASSETS,
        PRODUCT_ARTIFACTS,
        VIDEOS,
        ACCOUNTS,
        ACCOUNT_RIGHTS,
        PRODUCT_TASK_RESOURCE_FACTS,
      ],
      useFactory: (
        materialContent: MaterialContent,
        materialAssets: MaterialAssets,
        productArtifacts: ProductArtifacts,
        videos: Videos,
        accounts: Accounts,
        accountRights: AccountRights,
        productTaskResourceFacts: ProductTaskResourceFactsAdapter,
      ): ContentAccess =>
        assembleContentAccess({
          assetResourceFacts: assembleAssetResourceFacts(materialAssets),
          productArtifactResourceFacts:
            assembleProductArtifactResourceFacts(productArtifacts),
          productTaskResourceFacts,
          videoResourceFacts: assembleVideoResourceFacts(videos),
          materialResourceFacts: assembleMaterialResourceFacts(materialContent),
          accountPermissions: assembleCurrentAccountPermissions(accounts),
          accountRights,
        }),
    },
  ],
  exports: [
    CONTENT_ACCESS,
    PRODUCT_ACCESS_HOLDERS,
    PRODUCT_SALE_AVAILABILITY,
    PRODUCT_MATERIALS,
    PRODUCT_MATERIAL_READING,
  ],
})
export class ContentAccessCompositionModule {}
