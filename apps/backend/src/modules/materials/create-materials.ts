import type { PlatformDatabase } from "../../infrastructure/postgres/index.js";
import type { ContentLibrary } from "../content-library/index.js";
import { createMaterialAuthoringImplementation } from "./application/create-material-authoring.js";
import { createPublishedMaterialReaderImplementation } from "./application/create-published-material-reader.js";
import type { MaterialAuthoring } from "./application/material-authoring.interface.js";
import type { AuthorPolicy } from "./application/ports/author-policy.js";
import {
  createBaselineContentAccess,
  type ContentAccess,
} from "./application/ports/content-access.js";
import type { PublishedMaterialReader } from "./application/published-material-reader.interface.js";
import { materialBodyOperations } from "./infrastructure/tiptap/index.js";

export interface Materials {
  readonly authoring: MaterialAuthoring;
  readonly publishedMaterialReader: PublishedMaterialReader;
}

export function createMaterials(dependencies: {
  readonly database: PlatformDatabase;
  readonly contentLibrary: Pick<ContentLibrary, "findPublishedMaterial">;
  readonly authorPolicy: AuthorPolicy;
  readonly contentAccess?: ContentAccess;
}): Materials {
  const contentAccess =
    dependencies.contentAccess ??
    createBaselineContentAccess(dependencies.authorPolicy);
  const shared = {
    database: dependencies.database,
    contentLibrary: dependencies.contentLibrary,
    authorPolicy: dependencies.authorPolicy,
    contentAccess,
    materialBodyOperations,
  };
  return Object.freeze({
    authoring: createMaterialAuthoringImplementation(shared),
    publishedMaterialReader: createPublishedMaterialReaderImplementation(shared),
  });
}
