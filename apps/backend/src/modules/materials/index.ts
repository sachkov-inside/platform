export { materialFormatSchema } from "./domain/material-format.js";
export type { MaterialAuthoring } from "./facets/material-authoring/material-authoring.js";
export {
  materialId,
  type MaterialId,
} from "./domain/material-identifiers.js";
export type { MaterialContent } from "./facets/material-content/material-content.js";
export { MATERIAL_CONTENT } from "./facets/material-content/material-content.js";
export { MaterialContentModule } from "./material-content.module.js";
export { assembleMaterialResourceFacts } from "./adapters/content-access/material-resource-facts.js";
export { MATERIAL_AUTHORING } from "./facets/material-authoring/material-authoring.token.js";
export type {
  MaterialMetadataDto,
  MaterialMetadataSelectionInput,
} from "./facets/material-authoring/material-authoring.contract.js";
export type {
  GuideIntroductionDto,
  GuideProductPageDto,
} from "./facets/material-authoring/content-collection.contract.js";
export { guidePageCardSchema, guidePageSchema, type GuidePageCard } from "./domain/guide-page.js";
export type { CreateDraftError } from "./features/create-draft/create-draft.contract.js";
export {
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
} from "./facets/published-material-reader/published-material-reader.js";
export type { PublishedMaterialProjectionCursor } from "./features/list-published-material-projections/list-published-material-projections.contract.js";
export type { MaterialDifficulty } from "./domain/material-metadata.js";
export type { PublishedMaterialProjectionDto } from "./facets/published-material-reader/published-material.contract.js";
export type { MaterialBodySnapshot } from "./domain/material-body/material-body.js";
export { MaterialsModule } from "./materials.module.js";
export { MaterialsHttpModule } from "./materials-http.module.js";
export { ContentScopeCatalogModule } from "./content-scope-catalog.module.js";
export { KinescopeVideoAuthorizationController } from "./adapters/nest/kinescope-video-authorization.controller.js";
export { MaterialAssetMaintenanceModule } from "./material-asset-maintenance.module.js";
export { assembleMaterialAuthoringMcpServer } from "./adapters/mcp/material-authoring-mcp.js";
export {
  assembleContentCovers,
  type ContentCoverOwner,
  type ContentCoverProjection,
} from "./facets/content-covers/content-covers.js";
export { assembleMaterials, type Materials } from "./assemble-materials.js";
export {
  contentCoverProjectionHttpSchema,
  publishedMaterialProblemHttpSchema,
  publishedMaterialProjectionHttpSchema,
} from "./adapters/nest/published-material-http.js";
export { assembleGuideArtifacts } from "./facets/guide-artifacts/assemble-guide-artifacts.js";
export { type GuideArtifacts } from "./facets/guide-artifacts/guide-artifacts.js";
export {
  assembleGuideArtifactDelivery,
  type GuideArtifactDelivery,
} from "./features/deliver-guide-artifact/deliver-guide-artifact.js";
export { assembleGuideArtifactResourceFacts } from "./adapters/content-access/guide-artifact-resource-facts.js";
export {
  MATERIAL_ASSET_MAINTENANCE,
  type MaterialAssetMaintenance,
} from "./features/cleanup-material-assets/cleanup-material-assets.js";

export { PublicContentTargets } from "./facets/public-content-targets/public-content-targets.js";

export { PublishedSeriesComposition, type PublishedSeriesCompositionResult } from "./features/read-published-series-composition/read-published-series-composition.js";

export { PublishedMaterialSelection } from "./features/select-published-materials/select-published-materials.js";
export { assembleMaterialsNotificationOutbox } from "./facets/notification-outbox/notification-outbox.js";
export { MaterialAnnouncements } from "./facets/material-announcements/material-announcements.js";

