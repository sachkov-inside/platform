export {
  CONTENT_AUTHORING,
  type ApplicationResult,
  type ContentAuthoring,
  type ContentAuthoringError,
  type CreateDraftCommand,
  type CreateDraftResult,
  type DraftMetadata,
  type DraftMetadataChanges,
  type DraftSnapshot,
  type DraftWriteValue,
  type LoadDraftQuery,
  type LoadDraftResult,
  type ReviseDraftCommand,
  type ReviseDraftResult,
  type SeriesMembershipInput,
} from "./content-authoring.interface.js";
export { ContentAuthoringModule } from "./content-authoring.module.js";
export type { AuthorPolicy } from "./internal/author-policy.js";

import type { ContentAuthoring } from "./content-authoring.interface.js";
import {
  ContentAuthoringImplementation,
  type ContentAuthoringDependencies,
} from "./internal/content-authoring.implementation.js";

export function createContentAuthoring(
  dependencies: ContentAuthoringDependencies,
): ContentAuthoring {
  return new ContentAuthoringImplementation(dependencies);
}
