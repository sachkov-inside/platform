import type { MaterialsPrismaClient } from "../../infrastructure/prisma/index.js";
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
  type ContentAccess,
} from "./ports/content-access.js";
import { materialBodyOperations } from "./infrastructure/tiptap/index.js";

export interface Materials {
  readonly authoring: MaterialAuthoring;
  readonly materialContent: MaterialContent;
  readonly publishedMaterialReader: PublishedMaterialReader;
}

export function assembleMaterials(dependencies: {
  readonly prisma: MaterialsPrismaClient;
  readonly authorPolicy: AuthorPolicy;
  readonly contentAccess?: ContentAccess;
}): Materials {
  const contentAccess =
    dependencies.contentAccess ??
    assembleBaselineContentAccess(dependencies.authorPolicy);
  const shared = {
    prisma: dependencies.prisma,
    authorPolicy: dependencies.authorPolicy,
    contentAccess,
    materialBodyOperations,
  };
  return Object.freeze({
    authoring: assembleMaterialAuthoring(shared),
    materialContent: assembleMaterialContent(shared),
    publishedMaterialReader: assemblePublishedMaterialReader(shared),
  });
}
