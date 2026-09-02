import type { MaterialsPrismaClient } from "../../infrastructure/prisma/index.js";
import type { MaterialAssets } from "../assets/index.js";
import {
  assembleContentAccess,
  assembleDeterministicMembershipEntitlements,
  type ContentAccess,
} from "../content-access/index.js";
import { assembleMaterialResourceFacts } from "./adapters/content-access/material-resource-facts.js";
import { assembleMaterialAuthoring } from "./facets/material-authoring/assemble-material-authoring.js";
import type { MaterialAuthoring } from "./facets/material-authoring/material-authoring.js";
import {
  assembleMaterialContent,
  type MaterialContent,
} from "./facets/material-content/material-content.js";
import { assemblePublishedMaterialReader } from "./facets/published-material-reader/assemble-published-material-reader.js";
import type { PublishedMaterialReader } from "./facets/published-material-reader/published-material-reader.js";
import type { AuthorPolicy } from "./ports/author-policy.js";
import type { Videos } from "../videos/index.js";
import { materialBodyOperations } from "./infrastructure/tiptap/index.js";

export interface Materials {
  readonly authoring: MaterialAuthoring;
  readonly contentAccess: ContentAccess;
  readonly materialContent: MaterialContent;
  readonly publishedMaterialReader: PublishedMaterialReader;
}

export function assembleMaterials(dependencies: {
  readonly prisma: MaterialsPrismaClient;
  readonly authorPolicy: AuthorPolicy;
  readonly contentAccess?: ContentAccess;
  readonly materialAssets?: Pick<
    MaterialAssets,
    "inspectReferences" | "loadPresentations" | "markUnreferenced"
  >;
  readonly membershipAcquisitionUrl?: string;
  readonly videos?: Pick<Videos, "inspectPrimaryReference" | "loadPresentation">;
}): Materials {
  const materialContent = assembleMaterialContent({
    prisma: dependencies.prisma,
    materialBodyOperations,
  });
  const contentAccess =
    dependencies.contentAccess ??
    assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(materialContent),
      accountPermissions: {
        hasMaterialsManage: async (accountId) =>
          dependencies.authorPolicy.canManage(accountId),
      },
      membershipEntitlements: assembleDeterministicMembershipEntitlements(),
    });
  const shared = {
    prisma: dependencies.prisma,
    authorPolicy: dependencies.authorPolicy,
    contentAccess,
    materialBodyOperations,
    ...(dependencies.materialAssets === undefined
      ? {}
      : { materialAssets: dependencies.materialAssets }),
    ...(dependencies.videos === undefined ? {} : { videos: dependencies.videos }),
  };
  return Object.freeze({
    authoring: assembleMaterialAuthoring(shared),
    contentAccess,
    materialContent,
    publishedMaterialReader: assemblePublishedMaterialReader({
      prisma: dependencies.prisma,
      contentAccess,
      materialContent,
      materialBodyOperations,
      ...(dependencies.videos === undefined ? {} : { videos: dependencies.videos }),
      membershipAcquisitionUrl:
        dependencies.membershipAcquisitionUrl ?? "https://t.me/tribute",
    }),
  });
}
