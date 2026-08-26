export {
  type MaterialAuthoring,
} from "./facets/material-authoring/material-authoring.js";
export type {
  MaterialRevisionMetadataChanges,
  MaterialRevisionMetadataDto,
  MaterialRevisionMetadataInput,
  MaterialRevisionDto,
  PublicationLifecycleEventDto,
  SeriesMembershipInput,
} from "./facets/material-authoring/material-authoring.contract.js";
export type {
  CreateDraftError,
  CreateDraftCommand,
  CreateDraftResult,
} from "./features/create-draft/create-draft.contract.js";
export type {
  LoadDraftError,
  LoadDraftQuery,
  LoadDraftResult,
} from "./features/load-draft/load-draft.contract.js";
export type {
  PreviewRevisionError,
  PreviewRevisionDto,
  PreviewRevisionQuery,
  PreviewRevisionResult,
} from "./features/preview-revision/preview-revision.contract.js";
export type {
  PublishRevisionError,
  PublishRevisionCommand,
  PublishRevisionResult,
} from "./features/publish-revision/publish-revision.contract.js";
export type {
  ReviseDraftError,
  ReviseDraftCommand,
  ReviseDraftResult,
} from "./features/revise-draft/revise-draft.contract.js";
export type {
  RestoreRevisionError,
  RestoreRevisionCommand,
  RestoreRevisionResult,
} from "./features/restore-revision/restore-revision.contract.js";
export type {
  ValidateRevisionError,
  ValidateRevisionQuery,
  ValidateRevisionResult,
  ValidatedRevisionDto,
} from "./features/validate-revision/validate-revision.contract.js";
export type {
  UnpublishMaterialError,
  UnpublishMaterialCommand,
  UnpublishMaterialResult,
} from "./features/unpublish-material/unpublish-material.contract.js";
export type { AuthorPolicy } from "./ports/author-policy.js";
export {
  anonymousSubject,
  assembleBaselineContentAccess,
  type AccessDecision,
  type ContentAccess,
  type MaterialBodyResource,
  type Subject,
} from "./ports/content-access.js";
export {
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
} from "./facets/published-material-reader/published-material-reader.js";
export type {
  ListPublishedMaterialProjectionsOperation,
  ListPublishedMaterialProjectionsQuery,
  PublishedMaterialProjectionListError,
  PublishedMaterialProjectionListResult,
  PublishedMaterialProjectionPageDto,
} from "./features/list-published-material-projections/list-published-material-projections.contract.js";
export type {
  PublishedMaterialProjectionDto,
} from "./facets/published-material-reader/published-material.contract.js";
export type {
  PublishedMaterialReadDto,
  PublishedMaterialReadError,
  PublishedMaterialReadResult,
} from "./features/read-published-material/read-published-material.contract.js";
export type {
  MaterialBodyChange,
  JsonObject,
  JsonValue,
  MaterialBodyExtraction,
  MaterialBodyResourceSummary,
  MaterialBodySnapshot,
  RenderedBlock,
  RenderedMark,
  RenderedMaterialBody,
  RenderedText,
  ValidationIssue,
} from "./domain/material-body/material-body.js";
export { MaterialsModule } from "./materials.module.js";
export { assembleMaterials, type Materials } from "./assemble-materials.js";
export { ReadPublishedMaterialController } from "./features/read-published-material/read-published-material.controller.js";
