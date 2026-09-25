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
export {
  VideoPlaybackController,
  VideoProgressController,
} from "./adapters/nest/video-playback.controller.js";
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
export { CreateDraftController } from "./features/create-draft/create-draft.controller.js";
export { DeleteDraftController } from "./features/delete-draft/delete-draft.controller.js";
export { LoadMaterialController } from "./features/load-material/load-material.controller.js";
export { LoadSeriesOrderController } from "./features/load-series-order/load-series-order.controller.js";
export { ListAuthoringReferencesController } from "./features/list-authoring-references/list-authoring-references.controller.js";
export { ListMaterialsController } from "./features/list-materials/list-materials.controller.js";
export { PreviewMaterialController } from "./features/preview-material/preview-material.controller.js";
export { ReorderSeriesController } from "./features/reorder-series/reorder-series.controller.js";
export { ReadPublishedMaterialController } from "./features/read-published-material/read-published-material.controller.js";
export { SaveMaterialController } from "./features/save-material/save-material.controller.js";
export { TransitionMaterialPublicationController } from "./features/transition-material-publication/transition-material-publication.controller.js";
export { ValidateMaterialController } from "./features/validate-material/validate-material.controller.js";
export { UploadMaterialAssetController } from "./features/upload-material-asset/upload-material-asset.controller.js";
export { DeliverMaterialAssetController } from "./features/deliver-material-asset/deliver-material-asset.controller.js";
export { CreateContentCollectionController } from "./features/create-content-collection/create-content-collection.controller.js";
export { ListContentCollectionsController } from "./features/list-content-collections/list-content-collections.controller.js";
export { SetContentCollectionArchiveController } from "./features/set-content-collection-archive/set-content-collection-archive.controller.js";
export { UpdateContentCollectionController } from "./features/update-content-collection/update-content-collection.controller.js";
export {
  AuthoringContentCoverController,
  ImportContentCoverController,
  ContentCoverDeliveryController,
} from "./facets/content-covers/content-covers.controller.js";
export { assembleGuideArtifacts } from "./facets/guide-artifacts/assemble-guide-artifacts.js";
export { type GuideArtifacts } from "./facets/guide-artifacts/guide-artifacts.js";
export { GuideArtifactAuthoringController } from "./facets/guide-artifacts/guide-artifacts.controller.js";
export {
  assembleGuideArtifactDelivery,
  type GuideArtifactDelivery,
} from "./features/deliver-guide-artifact/deliver-guide-artifact.js";
export { GuideArtifactReadController } from "./features/deliver-guide-artifact/deliver-guide-artifact.controller.js";
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

export { LoadHomePinController } from "./features/load-home-pin/load-home-pin.controller.js";
export { SetHomePinController } from "./features/set-home-pin/set-home-pin.controller.js";

export { ContentScopeCatalog } from "./facets/content-scope-catalog/content-scope-catalog.js";

export { ImportSourceMaterialController } from "./features/import-source-material/import-source-material.controller.js";

export { ImportSourceGuideController } from "./features/import-source-guide/import-source-guide.controller.js";
