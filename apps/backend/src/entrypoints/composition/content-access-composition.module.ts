import { Global, Module } from "@nestjs/common";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  ACCESS_GRANTS,
  ACCOUNT_RIGHTS,
  AccountRightsModule,
  type AccountRights,
} from "../../modules/account-rights/index.js";
import {
  ACCOUNTS,
  AccountsModule,
  type Accounts,
} from "../../modules/accounts/index.js";
import {
  AssetsModule,
  MATERIAL_ASSETS,
  type MaterialAssets,
} from "../../modules/assets/index.js";
import { BillingModule } from "../../modules/billing/index.js";
import {
  CONTENT_ACCESS,
  PRODUCT_TASK_RESOURCE_FACTS,
  assembleContentAccess,
  assembleCurrentAccountPermissions,
  type ContentAccess,
  type ProductTaskResourceFactsAdapter,
} from "../../modules/content-access/index.js";
import {
  MATERIAL_CONTENT,
  MATERIAL_PUBLICATION,
  MaterialContentModule,
  MaterialsModule,
  PRODUCT_ACCESS_HOLDERS,
  PRODUCT_SALE_AVAILABILITY,
  assembleAssetResourceFacts,
  assembleMaterialResourceFacts,
  assembleProductMaterialReading,
  assembleProductMaterials,
  assembleVideoResourceFacts,
  type MaterialContent,
} from "../../modules/materials/index.js";
import { ProductTaskResourceFactsModule } from "../../modules/product-tasks/index.js";
import {
  PRODUCT_ARTIFACTS,
  PRODUCT_MATERIALS,
  PRODUCT_MATERIAL_READING,
  ProductArtifactsModule,
  ProductCatalogue,
  ProductDiscovery,
  ProductsModule,
  assembleProductArtifactResourceFacts,
  type ProductArtifacts,
} from "../../modules/products/index.js";
import {
  TelegramAccountLinks,
  TelegramAccountLinksModule,
} from "../../modules/telegram-membership/index.js";
import {
  VIDEOS,
  VideosModule,
  type Videos,
} from "../../modules/videos/index.js";
import { composeMaterialAccessFacts } from "./material-access-facts.js";
import { assembleTelegramLinks } from "./telegram-links.js";

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
    TelegramAccountLinksModule,
  ],
  providers: [
    {
      provide: PRODUCT_MATERIAL_READING,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        assembleProductMaterialReading(prisma),
    },
    {
      provide: MATERIAL_CONTENT,
      inject: [MATERIAL_PUBLICATION, ProductCatalogue],
      useFactory: (materials: MaterialContent, products: ProductCatalogue) =>
        composeMaterialAccessFacts(materials, products),
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
      useValue: () => Promise.resolve(false),
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
        TelegramAccountLinks,
      ],
      useFactory: (
        materialContent: MaterialContent,
        materialAssets: MaterialAssets,
        productArtifacts: ProductArtifacts,
        videos: Videos,
        accounts: Accounts,
        accountRights: AccountRights,
        productTaskResourceFacts: ProductTaskResourceFactsAdapter,
        telegramAccountLinks: TelegramAccountLinks,
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
          telegramLinks: assembleTelegramLinks(telegramAccountLinks),
        }),
    },
  ],
  exports: [
    MATERIAL_CONTENT,
    CONTENT_ACCESS,
    PRODUCT_ACCESS_HOLDERS,
    PRODUCT_SALE_AVAILABILITY,
    PRODUCT_MATERIALS,
    PRODUCT_MATERIAL_READING,
  ],
})
export class ContentAccessCompositionModule {}
