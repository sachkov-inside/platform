export {
  CONTENT_AUTHORING,
  type ApplicationResult,
  type ContentAuthoring,
  type ContentAuthoringError,
  type CreateDraftCommand,
  type CreateDraftResult,
  type MaterialMetadataChanges,
  type MaterialMetadataDto,
  type MaterialMetadataInput,
  type MaterialDraftDto,
  type LoadDraftQuery,
  type LoadDraftResult,
  type ReviseDraftCommand,
  type ReviseDraftResult,
  type SeriesMembershipInput,
} from "./application/content-authoring.interface.js";
export type { AuthorPolicy } from "./application/ports/author-policy.js";
export type {
  DocumentChange,
  JsonObject,
  JsonValue,
  MaterialDocumentV1,
  ValidationIssue,
} from "./domain/material-document/material-document.js";
export { MaterialsModule } from "./materials.module.js";

import type { PlatformDatabase } from "../../infrastructure/postgres/index.js";
import type { AuthorPolicy } from "./application/ports/author-policy.js";
import type { ContentAuthoring } from "./application/content-authoring.interface.js";
import { createContentAuthoringImplementation } from "./application/create-content-authoring.js";
import { materialDocument } from "./infrastructure/tiptap/index.js";

export function createContentAuthoring(dependencies: {
  readonly database: PlatformDatabase;
  readonly authorPolicy: AuthorPolicy;
}): ContentAuthoring {
  return createContentAuthoringImplementation({
    ...dependencies,
    materialDocument,
  });
}
