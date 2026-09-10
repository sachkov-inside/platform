export { materialFormatSchema, materialFormats, materialFormatPresentation, type MaterialFormat } from "./domain/material-format.js";
export type { MaterialAuthoring } from "./facets/material-authoring/material-authoring.js";
export {
  materialId,
  type MaterialId,
} from "./domain/material-identifiers.js";
export type {
  MaterialAccessFacts,
  MaterialContent,
} from "./facets/material-content/material-content.js";
export { MATERIAL_CONTENT } from "./facets/material-content/material-content.js";
export { MaterialContentModule } from "./material-content.module.js";
export { assembleMaterialResourceFacts } from "./adapters/content-access/material-resource-facts.js";
export { MATERIAL_AUTHORING } from "./facets/material-authoring/material-authoring.token.js";
export type {
  MaterialDto,
  MaterialMetadataDto,
  MaterialMetadataSelectionInput,
  MaterialMutationReceiptDto,
  GuideMembershipInput,
} from "./facets/material-authoring/material-authoring.contract.js";
export type {
  ContentCollectionDto,
  ContentCollectionKind,
} from "./facets/material-authoring/content-collection.contract.js";
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
  LoadSeriesOrderError,
  LoadSeriesOrderQuery,
  LoadSeriesOrderResult,
  SeriesOrderDto,
  SeriesOrderMaterialDto,
} from "./features/load-series-order/load-series-order.contract.js";
export type {
  AuthoringMaterialListItemDto,
  AuthoringMaterialPageDto,
  ListMaterialsError,
  ListMaterialsQuery,
  ListMaterialsResult,
} from "./features/list-materials/list-materials.contract.js";
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
  ReorderSeriesCommand,
  ReorderSeriesError,
  ReorderSeriesReceiptDto,
  ReorderSeriesResult,
} from "./features/reorder-series/reorder-series.contract.js";
export type {
  CreateContentCollectionCommand,
  CreateContentCollectionError,
  CreateContentCollectionResult,
} from "./features/create-content-collection/create-content-collection.contract.js";
export type {
  ListContentCollectionsQuery,
  ListContentCollectionsResult,
} from "./features/list-content-collections/list-content-collections.contract.js";
export type {
  SetContentCollectionArchiveCommand,
  SetContentCollectionArchiveError,
  SetContentCollectionArchiveResult,
} from "./features/set-content-collection-archive/set-content-collection-archive.contract.js";
export type {
  UpdateContentCollectionCommand,
  UpdateContentCollectionError,
  UpdateContentCollectionResult,
} from "./features/update-content-collection/update-content-collection.contract.js";
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
  PublishedMaterialProjectionCursor,
  PublishedMaterialProjectionSort,
  PublishedMaterialProjectionPageDto,
} from "./features/list-published-material-projections/list-published-material-projections.contract.js";
export type {
  DiscoverPublishedMaterialProjectionsOperation,
  DiscoverPublishedMaterialProjectionsQuery,
  PublishedMaterialDiscoveryError,
  PublishedMaterialDiscoveryPageDto,
  PublishedMaterialDiscoveryResult,
} from "./features/discover-published-material-projections/discover-published-material-projections.contract.js";
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
export {
  VideoPlaybackController,
  VideoProgressController,
} from "./adapters/nest/video-playback.controller.js";
export { KinescopeVideoAuthorizationController } from "./adapters/nest/kinescope-video-authorization.controller.js";
export { VIDEO_PLAYBACK, assembleVideoPlayback } from "./facets/video-playback/video-playback.js";
export { MaterialAssetMaintenanceModule } from "./material-asset-maintenance.module.js";
export { assembleMaterialAuthoringMcpServer } from "./adapters/mcp/material-authoring-mcp.js";
export {
  assembleContentCovers,
  type ChangeContentCoverCommand,
  type ChangeContentCoverResult,
  type ContentCoverOwner,
  type ContentCoverProjection,
  type ContentCovers,
  type DeliverContentCoverResult,
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
export type {
  TransitionMaterialPublicationCommand,
  TransitionMaterialPublicationError,
  TransitionMaterialPublicationOperation,
} from "./features/transition-material-publication/transition-material-publication.contract.js";
export { ValidateMaterialController } from "./features/validate-material/validate-material.controller.js";
export { UploadMaterialAssetController } from "./features/upload-material-asset/upload-material-asset.controller.js";
export { DeliverMaterialAssetController } from "./features/deliver-material-asset/deliver-material-asset.controller.js";
export { CreateContentCollectionController } from "./features/create-content-collection/create-content-collection.controller.js";
export { ListContentCollectionsController } from "./features/list-content-collections/list-content-collections.controller.js";
export { SetContentCollectionArchiveController } from "./features/set-content-collection-archive/set-content-collection-archive.controller.js";
export { UpdateContentCollectionController } from "./features/update-content-collection/update-content-collection.controller.js";
export {
  AuthoringContentCoverController,
  ContentCoverDeliveryController,
} from "./facets/content-covers/content-covers.controller.js";
export { assembleGuideArtifacts } from "./facets/guide-artifacts/assemble-guide-artifacts.js";
export {
  GUIDE_ARTIFACTS,
  guideArtifactAccessSchema,
  type AuthoringGuideArtifactSource,
  type AuthoringImportOutcome,
  type AuthoringImportReport,
  type GuideArtifactAccess,
  type GuideArtifactAccessFacts,
  type GuideArtifactContent,
  type GuideArtifactDto,
  type GuideArtifactError,
  type GuideArtifactFileDelivery,
  type GuideArtifactOrigin,
  type GuideArtifactResult,
  type GuideArtifacts,
  type ReaderGuideArtifact,
} from "./facets/guide-artifacts/guide-artifacts.js";
export {
  GuideArtifactAuthoringController,
  guideArtifactHttpSchema,
  guideArtifactProblemSchema,
} from "./facets/guide-artifacts/guide-artifacts.controller.js";
export {
  assembleGuideArtifactDelivery,
  GUIDE_ARTIFACT_DELIVERY,
  type DeliveredGuideArtifact,
  type GuideArtifactDelivery,
  type PublicGuideArtifactDto,
} from "./features/deliver-guide-artifact/deliver-guide-artifact.js";
export { GuideArtifactReadController } from "./features/deliver-guide-artifact/deliver-guide-artifact.controller.js";
export { assembleGuideArtifactResourceFacts } from "./adapters/content-access/guide-artifact-resource-facts.js";
export {
  MATERIAL_ASSET_MAINTENANCE,
  type CleanupMaterialAssetsResult,
  type MaterialAssetMaintenance,
} from "./features/cleanup-material-assets/cleanup-material-assets.js";

export { PublicContentTargets, type PublicContentTarget, type PublicContentTargetResult } from "./facets/public-content-targets/public-content-targets.js";

export { PublishedSeriesComposition, type PublishedSeriesCompositionResult } from "./features/read-published-series-composition/read-published-series-composition.js";

export { PublishedMaterialSelection } from "./features/select-published-materials/select-published-materials.js";
export { assembleMaterialsNotificationOutbox } from "./facets/notification-outbox/notification-outbox.js";

export { LoadHomePinController } from "./features/load-home-pin/load-home-pin.controller.js";
export { SetHomePinController } from "./features/set-home-pin/set-home-pin.controller.js";
