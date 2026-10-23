export { materialFormatSchema } from "./domain/material-format.js";
export type { MaterialAuthoring } from "./facets/material-authoring/material-authoring.js";
export { materialId, type MaterialId } from "./domain/material-identifiers.js";
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
  ProductIntroductionDto,
  ProductLandingPageDto,
} from "./facets/material-authoring/content-collection.contract.js";
export {
  productPageCardSchema,
  productPageHeroSchema,
  productPageSchema,
  type ProductPageCard,
  type ProductPageHero,
} from "./domain/product-page.js";
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
export { CoverageCatalogModule } from "./coverage-catalog.module.js";
export { KinescopeVideoAuthorizationController } from "./adapters/nest/kinescope-video-authorization.controller.js";
export { MaterialAssetMaintenanceModule } from "./material-asset-maintenance.module.js";
export { assembleMaterialAuthoringMcpServer } from "./adapters/mcp/material-authoring-mcp.js";
export {
  contentCoverProjectionHttpSchema,
  publishedMaterialProblemHttpSchema,
  publishedMaterialProjectionHttpSchema,
} from "./adapters/nest/published-material-http.js";

export {
  MATERIAL_ASSET_MAINTENANCE,
  type MaterialAssetMaintenance,
} from "./features/cleanup-material-assets/cleanup-material-assets.js";

export { PublicContentTargets } from "./facets/public-content-targets/public-content-targets.js";

export { PublishedMaterialSelection } from "./features/select-published-materials/select-published-materials.js";
export { assembleMaterialsNotificationOutbox } from "./facets/notification-outbox/notification-outbox.js";
export { MaterialAnnouncements } from "./facets/material-announcements/material-announcements.js";

export { materialBodyOperations } from "./infrastructure/tiptap/index.js";

export {
  attachmentDisposition,
  signedDeliveryTtlSeconds,
} from "./shared/protected-delivery.js";

export { hydrateMaterialAssets } from "./domain/material-body/hydrate-material-assets.js";

export { PublicMaterialAnnouncements } from "./facets/public-material-announcements/public-material-announcements.js";

export { PRODUCT_ACCESS_HOLDERS } from "./ports/product-access-holders.js";
export { PRODUCT_SALE_AVAILABILITY } from "./ports/product-sale-availability.js";

export { assembleAssetResourceFacts } from "./adapters/content-access/asset-resource-facts.js";
export { assembleVideoResourceFacts } from "./adapters/content-access/video-resource-facts.js";

export { MaterialCoverSelection } from "./infrastructure/postgres/material-cover-selection.js";
export { assembleProductMaterials } from "./adapters/products/product-materials.js";

export { assembleMaterialAuthoring } from "./facets/material-authoring/assemble-material-authoring.js";
export { assembleMaterialContent } from "./facets/material-content/material-content.js";
export { assemblePublishedMaterialReader } from "./facets/published-material-reader/assemble-published-material-reader.js";

export type { AuthorPolicy } from "./ports/author-policy.js";
export type { ProductAccessHolders } from "./ports/product-access-holders.js";

export { assembleProductMaterialReading } from "./infrastructure/postgres/product-material-reading.js";
