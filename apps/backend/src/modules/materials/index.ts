export {
  CONTENT_AUTHORING,
  type ApplicationResult,
  type ContentAuthoring,
  type ContentAuthoringError,
  type CreateDraftCommand,
  type CreateDraftResult,
  type MaterialRevisionMetadataChanges,
  type MaterialRevisionMetadataDto,
  type MaterialRevisionMetadataInput,
  type MaterialRevisionDto,
  type LoadDraftQuery,
  type LoadDraftResult,
  type PreviewRevisionDto,
  type PreviewRevisionResult,
  type PublicationLifecycleEventDto,
  type PublishRevisionCommand,
  type PublishRevisionResult,
  type ReviseDraftCommand,
  type ReviseDraftResult,
  type RestoreRevisionCommand,
  type RestoreRevisionResult,
  type SeriesMembershipInput,
  type ValidateRevisionQuery,
  type ValidateRevisionResult,
  type ValidatedRevisionDto,
  type UnpublishMaterialCommand,
  type UnpublishMaterialResult,
} from "./application/content-authoring.interface.js";
export type { AuthorPolicy } from "./application/ports/author-policy.js";
export {
  anonymousSubject,
  createBaselineContentAccess,
  type AccessDecision,
  type ContentAccess,
  type MaterialBodyResource,
  type Subject,
} from "./application/ports/content-access.js";
export {
  PUBLISHED_MATERIALS,
  type PublishedMaterialReadDto,
  type PublishedMaterialReadResult,
  type PublishedMaterials,
  type PublicMaterialProjectionDto,
} from "./application/published-materials.interface.js";
export type {
  DocumentChange,
  JsonObject,
  JsonValue,
  MaterialDocumentExtraction,
  MaterialDocumentResource,
  MaterialDocumentV1,
  RenderedBlock,
  RenderedMark,
  RenderedMaterialDocumentV1,
  RenderedText,
  ValidationIssue,
} from "./domain/material-document/material-document.js";
export { MaterialsModule } from "./materials.module.js";

import type { PlatformDatabase } from "../../infrastructure/postgres/index.js";
import type { AuthorPolicy } from "./application/ports/author-policy.js";
import {
  createBaselineContentAccess,
  type ContentAccess,
} from "./application/ports/content-access.js";
import type { ContentAuthoring } from "./application/content-authoring.interface.js";
import { createContentAuthoringImplementation } from "./application/create-content-authoring.js";
import type { PublishedMaterials } from "./application/published-materials.interface.js";
import { createPublishedMaterialsImplementation } from "./application/create-published-materials.js";
import { materialDocumentOperations } from "./infrastructure/tiptap/index.js";

export function createContentAuthoring(dependencies: {
  readonly database: PlatformDatabase;
  readonly authorPolicy: AuthorPolicy;
  readonly contentAccess?: ContentAccess;
}): ContentAuthoring {
  return createContentAuthoringImplementation({
    database: dependencies.database,
    authorPolicy: dependencies.authorPolicy,
    contentAccess:
      dependencies.contentAccess ?? createBaselineContentAccess(dependencies.authorPolicy),
    materialDocumentOperations,
  });
}

export function createPublishedMaterials(dependencies: {
  readonly database: PlatformDatabase;
  readonly contentAccess: ContentAccess;
}): PublishedMaterials {
  return createPublishedMaterialsImplementation({
    ...dependencies,
    materialDocumentOperations,
  });
}
