import type { MaterialsPrismaClient } from "../../infrastructure/prisma/index.js";
import {
  assembleContentAccess,
  assembleDeterministicMembershipEntitlements,
  type ContentAccess as PublishedContentAccess,
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
import {
  assembleBaselineContentAccess,
  type ContentAccess as AuthoringContentAccess,
} from "./ports/content-access.js";
import { materialBodyOperations } from "./infrastructure/tiptap/index.js";

export interface Materials {
  readonly authoring: MaterialAuthoring;
  readonly contentAccess: PublishedContentAccess;
  readonly materialContent: MaterialContent;
  readonly publishedMaterialReader: PublishedMaterialReader;
}

export function assembleMaterials(dependencies: {
  readonly prisma: MaterialsPrismaClient;
  readonly authorPolicy: AuthorPolicy;
  readonly authoringContentAccess?: AuthoringContentAccess;
  readonly publishedContentAccess?: PublishedContentAccess;
  readonly membershipAcquisitionUrl?: string;
}): Materials {
  const authoringContentAccess =
    dependencies.authoringContentAccess ??
    assembleBaselineContentAccess(dependencies.authorPolicy);
  const materialContent = assembleMaterialContent({
    prisma: dependencies.prisma,
    materialBodyOperations,
  });
  const publishedContentAccess =
    dependencies.publishedContentAccess ??
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
    contentAccess: authoringContentAccess,
    materialBodyOperations,
  };
  return Object.freeze({
    authoring: assembleMaterialAuthoring(shared),
    contentAccess: publishedContentAccess,
    materialContent,
    publishedMaterialReader: assemblePublishedMaterialReader({
      prisma: dependencies.prisma,
      contentAccess: publishedContentAccess,
      materialContent,
      materialBodyOperations,
      membershipAcquisitionUrl:
        dependencies.membershipAcquisitionUrl ?? "https://t.me/tribute",
    }),
  });
}
