import { ProductMemberships } from "../../modules/products/index.js";
import { assembleProductAuthoring } from "../../modules/products/index.js";
import { assembleProductMaterials } from "../../modules/materials/index.js";
import { loadContentCoverProjections } from "../../modules/content-covers/index.js";
import { transactionHandle } from "../../infrastructure/prisma/index.js";
import {
  ProductCatalogue,
  ProductDiscovery,
} from "../../modules/products/index.js";
import type { PlatformPrisma } from "../../infrastructure/prisma/index.js";
import type { MaterialAssets } from "../../modules/assets/index.js";
import {
  assembleContentAccess,
  assembleDeterministicAccountRights,
  type ContentAccess,
} from "../../modules/content-access/index.js";
import { assembleMaterialResourceFacts } from "../../modules/materials/index.js";
import { assembleMaterialAuthoring } from "../../modules/materials/index.js";
import type { MaterialAuthoring } from "../../modules/materials/index.js";
import {
  assembleMaterialContent,
  type MaterialContent,
} from "../../modules/materials/index.js";
import { assemblePublishedMaterialReader } from "../../modules/materials/index.js";
import type { PublishedMaterialReader } from "../../modules/materials/index.js";
import type { AuthorPolicy } from "../../modules/materials/index.js";
import type { ProductAccessHolders } from "../../modules/materials/index.js";
import type { Videos } from "../../modules/videos/index.js";
import { materialBodyOperations } from "../../modules/materials/index.js";

export interface Materials {
  readonly authoring: MaterialAuthoring;
  readonly contentAccess: ContentAccess;
  readonly materialContent: MaterialContent;
  readonly publishedMaterialReader: PublishedMaterialReader;
}

export function assembleMaterials(dependencies: {
  readonly prisma: PlatformPrisma;
  readonly authorPolicy: AuthorPolicy;
  readonly contentAccess?: ContentAccess;
  readonly materialAssets?: Pick<
    MaterialAssets,
    "inspectReferences" | "loadPresentations"
  >;
  readonly productAccessHolders?: ProductAccessHolders;
  readonly videos?: Pick<
    Videos,
    | "inspectPrimaryReference"
    | "loadAuthoringPresentation"
    | "loadLatestDeletion"
    | "loadUnselectedUpload"
    | "loadPresentation"
  >;
}): Materials {
  const materialContent = assembleMaterialContent({
    prisma: dependencies.prisma,
    materialBodyOperations,
    productCatalogue: new ProductCatalogue(dependencies.prisma),
  });
  const contentAccess =
    dependencies.contentAccess ??
    assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(materialContent),
      accountPermissions: {
        hasMaterialsManage: async (accountId) =>
          dependencies.authorPolicy.canManage(accountId),
      },
      accountRights: assembleDeterministicAccountRights(),
    });
  const shared = {
    discovery: new ProductDiscovery(dependencies.prisma),
    memberships: new ProductMemberships(dependencies.prisma),
    prisma: dependencies.prisma,
    products: assembleProductAuthoring({
      prisma: dependencies.prisma,
      authorPolicy: dependencies.authorPolicy,
      materials: assembleProductMaterials(
        dependencies.prisma,
        new ProductDiscovery(dependencies.prisma),
      ),
      ...(dependencies.productAccessHolders === undefined
        ? {}
        : { productAccessHolders: dependencies.productAccessHolders }),
      loadCovers: (ids, handle) =>
        loadContentCoverProjections(
          handle ?? transactionHandle(dependencies.prisma),
          ids,
        ),
    }),
    authorPolicy: dependencies.authorPolicy,
    contentAccess,
    materialBodyOperations,
    ...(dependencies.materialAssets === undefined
      ? {}
      : { materialAssets: dependencies.materialAssets }),
    ...(dependencies.videos === undefined
      ? {}
      : { videos: dependencies.videos }),
    ...(dependencies.productAccessHolders === undefined
      ? {}
      : { productAccessHolders: dependencies.productAccessHolders }),
  };
  return Object.freeze({
    authoring: assembleMaterialAuthoring(shared),
    contentAccess,
    materialContent,
    publishedMaterialReader: assemblePublishedMaterialReader({
      prisma: dependencies.prisma,
      products: new ProductDiscovery(dependencies.prisma),
      contentAccess,
      materialContent,
      materialBodyOperations,
      ...(dependencies.videos === undefined
        ? {}
        : { videos: dependencies.videos }),
    }),
  });
}
