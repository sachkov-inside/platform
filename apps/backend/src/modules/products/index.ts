export { ProductCatalogue } from "./facets/product-catalogue/product-catalogue.js";
export { ProductCoverSelection } from "./adapters/product-cover-selection.js";
export { ProductsModule } from "./products.module.js";
export {
  ProductCompositions,
  MAX_PRODUCT_MATERIALS,
  productCompositionChapters,
  readProductCompositionAccess,
  loadMaterialProductAccessFacts,
  type ProductComposition,
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
  type ProductMaterialFacts,
} from "./ports/product-materials.js";
