export { ProductCatalogue } from "./facets/product-catalogue/product-catalogue.js";
export { ProductCoverSelection } from "./adapters/product-cover-selection.js";
export { ProductsModule } from "./products.module.js";
export {
  ProductCompositions,
  MAX_PRODUCT_MATERIALS,
  productCompositionChapters,
  readProductCompositionAccess,
} from "./facets/product-compositions/product-compositions.js";
export { ProductDiscovery } from "./facets/product-catalogue/product-discovery.js";
export {
  productPresentations,
  productPresentationSchema,
  productPageTerms,
  productPageBlockSchema,
  productPageHeroSchema,
  productPageHero,
  productPageCardSchema,
  productPageSchema,
  readStoredProductPage,
} from "./domain/product-page.js";
export type {
  ProductPresentation,
  ProductPageHero,
  ProductPageCard,
  ProductPageBlock,
  ProductSourceFields,
  ProductPage,
} from "./domain/product-page.js";
export {
  readProductPage,
  readProductPageState,
} from "./shared/product-page-reader.js";
export {
  PRODUCT_CHAPTER_NAME_MAX,
  PRODUCT_CHAPTER_SUMMARY_MAX,
  productChapterNameSchema,
  productChapterSummarySchema,
  productChapterDraftSchema,
  productChapterDraftsSchema,
  productChapterAssignmentsSchema,
  productProgrammePlacementsSchema,
} from "./shared/product-chapters.js";
export type {
  ProductChapterDraft,
  ProductProgrammePlacement,
} from "./shared/product-chapters.js";
export { productOrderVersion } from "./shared/product-order-version.js";
export type {
  ProductCompositionEntry,
  ProductChapterEntry,
} from "./shared/product-order-version.js";
export {
  seriesStepGroupSchema,
  seriesStepGroupsSchema,
} from "./shared/series-step-groups.js";
export {
  PRODUCT_MATERIALS,
  type ProductMaterials,
} from "./ports/product-materials.js";
export type {
  CreateContentCollectionCommand,
  CreateContentCollectionError,
  CreateContentCollectionResult,
  CreateContentCollectionOperation,
} from "./features/create-content-collection/create-content-collection.contract.js";
export type {
  UpdateContentCollectionCommand,
  UpdateContentCollectionError,
  UpdateContentCollectionResult,
  UpdateContentCollectionOperation,
} from "./features/update-content-collection/update-content-collection.contract.js";
export type {
  SetContentCollectionArchiveCommand,
  SetContentCollectionArchiveError,
  SetContentCollectionArchiveResult,
  SetContentCollectionArchiveOperation,
} from "./features/set-content-collection-archive/set-content-collection-archive.contract.js";
export type {
  ListContentCollectionsQuery,
  ListContentCollectionsResult,
  ListContentCollectionsOperation,
} from "./features/list-content-collections/list-content-collections.contract.js";
export type {
  ProductChapterDto,
  SeriesOrderMaterialDto,
  SeriesOrderDto,
  LoadSeriesOrderQuery,
  SeriesNotFoundError,
  LoadSeriesOrderError,
  LoadSeriesOrderResult,
  LoadSeriesOrderOperation,
} from "./features/load-series-order/load-series-order.contract.js";
export type {
  ReorderSeriesCommand,
  ReorderSeriesReceiptDto,
  StaleSeriesOrderError,
  ReorderSeriesError,
  ReorderSeriesResult,
  ReorderSeriesOperation,
} from "./features/reorder-series/reorder-series.contract.js";
export { productChapterPlacementIssues } from "./features/reorder-series/product-chapter-placement.js";
export { reorderSeriesCommandSchema } from "./features/reorder-series/reorder-series.js";
export {
  reserveSourceProductBodySchema,
  updateSourceProductBodySchema,
  reorderSourceProductBodySchema,
  validateSourceProductBodySchema,
} from "./features/import-source-product/import-source-product.contract.js";
export type {
  ValidateSourceProductOperation,
  ReserveSourceProductOperation,
  UpdateSourceProductOperation,
  ReorderSourceProductOperation,
} from "./features/import-source-product/import-source-product.contract.js";
export { chapterAttachmentsBodySchema } from "./features/update-chapter-attachments/update-chapter-attachments.js";
export type { UpdateChapterAttachmentsOperation } from "./features/update-chapter-attachments/update-chapter-attachments.js";
export { PRODUCT_INTRODUCTION_FIELD_MAX } from "./facets/product-authoring/content-collection.contract.js";
export type {
  ContentCollectionKind,
  ProductIntroductionDto,
  ContentCollectionDto,
  ProductLandingPageDto,
} from "./facets/product-authoring/content-collection.contract.js";
export {
  heldProductRemovals,
  unconfirmedProductRemovals,
  recordProductRemovals,
} from "./shared/product-removal-confirmation.js";
export {
  assembleProductAuthoring,
  PRODUCT_AUTHORING,
  type ProductAuthoring,
} from "./facets/product-authoring/product-authoring.js";

export {
  ProductMemberships,
  PRODUCT_MEMBERSHIPS,
} from "./facets/product-memberships/product-memberships.js";

export type {
  HomePinDto,
  LoadHomePinOperation,
} from "./features/load-home-pin/load-home-pin.contract.js";

export type {
  SetHomePinCommand,
  SetHomePinError,
  SetHomePinOperation,
} from "./features/set-home-pin/set-home-pin.contract.js";
export { assembleProductArtifacts } from "./facets/product-artifacts/assemble-product-artifacts.js";
export {
  PRODUCT_ARTIFACTS,
  type ProductArtifacts,
} from "./facets/product-artifacts/product-artifacts.js";
export {
  assembleProductArtifactDelivery,
  type ProductArtifactDelivery,
} from "./features/deliver-product-artifact/deliver-product-artifact.js";
export { assembleProductArtifactResourceFacts } from "./adapters/content-access/product-artifact-resource-facts.js";

export { ProductArtifactsModule } from "./product-artifacts.module.js";
export { ProductArtifactsHttpModule } from "./product-artifacts-http.module.js";

export {
  ProductDirectory,
  type DirectoryProduct,
} from "./features/read-product-directory/read-product-directory.js";
export { ProductOutlines } from "./features/list-product-outlines/list-product-outlines.js";
export {
  PublishedSeriesComposition,
  type PublishedSeriesCompositionResult,
} from "./features/read-published-series-composition/read-published-series-composition.js";
export { ProductCompositionsReading } from "./facets/product-compositions-reading/product-compositions-reading.js";
export { ProductReadingModule } from "./product-reading.module.js";
export {
  PRODUCT_MATERIAL_READING,
  type ProductMaterialReading,
} from "./ports/product-material-reading.js";
