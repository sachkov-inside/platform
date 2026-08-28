export type { MaterialAuthoring } from "./facets/material-authoring/material-authoring.js";
export {
  materialId,
  type MaterialId,
} from "./domain/material-identifiers.js";
export type {
  MaterialAccessFacts,
  MaterialContent,
} from "./facets/material-content/material-content.js";
export { assembleMaterialResourceFacts } from "./adapters/content-access/material-resource-facts.js";
export { MATERIAL_AUTHORING } from "./facets/material-authoring/material-authoring.token.js";
export type {
  MaterialDto,
  MaterialMetadataInput,
  MaterialMutationReceiptDto,
  SeriesMembershipInput,
} from "./facets/material-authoring/material-authoring.contract.js";
export type {
  CreateDraftCommand,
  CreateDraftError,
  CreateDraftResult,
} from "./features/create-draft/create-draft.contract.js";
export type {
  DeleteDraftCommand,
  DeleteDraftError,
  DeleteDraftResult,
} from "./features/delete-draft/delete-draft.contract.js";
export type {
  LoadMaterialError,
  LoadMaterialQuery,
  LoadMaterialResult,
} from "./features/load-material/load-material.contract.js";
export type {
  PreviewMaterialDto,
  PreviewMaterialError,
  PreviewMaterialQuery,
  PreviewMaterialResult,
} from "./features/preview-material/preview-material.contract.js";
export type {
  SaveMaterialCommand,
  SaveMaterialError,
  SaveMaterialResult,
} from "./features/save-material/save-material.contract.js";
export type {
  ValidateMaterialError,
  ValidateMaterialQuery,
  ValidateMaterialResult,
  ValidatedMaterialDto,
} from "./features/validate-material/validate-material.contract.js";
export type { AuthorPolicy } from "./ports/author-policy.js";
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
export type { PublishedMaterialProjectionDto } from "./facets/published-material-reader/published-material.contract.js";
export type {
  LockedMaterialAccessDto,
  PublishedMaterialReadDto,
  PublishedMaterialReadError,
  PublishedMaterialReadResult,
} from "./features/read-published-material/read-published-material.contract.js";
export type {
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
export {
  publishedMaterialProblemHttpSchema,
  publishedMaterialProjectionHttpSchema,
} from "./adapters/nest/published-material-http.js";
export { CreateDraftController } from "./features/create-draft/create-draft.controller.js";
export { DeleteDraftController } from "./features/delete-draft/delete-draft.controller.js";
export { LoadMaterialController } from "./features/load-material/load-material.controller.js";
export { PreviewMaterialController } from "./features/preview-material/preview-material.controller.js";
export { ReadPublishedMaterialController } from "./features/read-published-material/read-published-material.controller.js";
export { SaveMaterialController } from "./features/save-material/save-material.controller.js";
export { ValidateMaterialController } from "./features/validate-material/validate-material.controller.js";
