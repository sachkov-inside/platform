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
import { assembleMaterialResourceFacts } from "../../modules/materials/adapters/content-access/material-resource-facts.js";
import { assembleMaterialAuthoring } from "../../modules/materials/facets/material-authoring/assemble-material-authoring.js";
import type { MaterialAuthoring } from "../../modules/materials/facets/material-authoring/material-authoring.js";
import {
  assembleMaterialContent,
  type MaterialContent,
} from "../../modules/materials/facets/material-content/material-content.js";
import { assemblePublishedMaterialReader } from "../../modules/materials/facets/published-material-reader/assemble-published-material-reader.js";
import type { PublishedMaterialReader } from "../../modules/materials/facets/published-material-reader/published-material-reader.js";
import type { AuthorPolicy } from "../../modules/materials/ports/author-policy.js";
import type { ProductAccessHolders } from "../../modules/materials/ports/product-access-holders.js";
import type { Videos } from "../../modules/videos/index.js";
import { materialBodyOperations } from "../../modules/materials/infrastructure/tiptap/index.js";

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
    prisma: dependencies.prisma,
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
