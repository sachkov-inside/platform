import { assembleLoadHomePin } from "../../features/load-home-pin/load-home-pin.js";
import { assembleSetHomePin } from "../../features/set-home-pin/set-home-pin.js";
import type { ProductAuthoringDependencies } from "./product-authoring.dependencies.js";
import { assembleCreateContentCollection } from "../../features/create-content-collection/create-content-collection.js";
import { assembleUpdateContentCollection } from "../../features/update-content-collection/update-content-collection.js";
import { assembleSetContentCollectionArchive } from "../../features/set-content-collection-archive/set-content-collection-archive.js";
import { assembleListContentCollections } from "../../features/list-content-collections/list-content-collections.js";
import { assembleLoadSeriesOrder } from "../../features/load-series-order/load-series-order.js";
import { assembleReorderSeries } from "../../features/reorder-series/reorder-series.js";
import { assembleUpdateChapterAttachments } from "../../features/update-chapter-attachments/update-chapter-attachments.js";
import { assembleReserveSourceProduct } from "../../features/import-source-product/import-source-product.js";
import { assembleValidateSourceProduct } from "../../features/import-source-product/import-source-product.js";
import { assembleUpdateSourceProduct } from "../../features/import-source-product/import-source-product.js";
import { assembleReorderSourceProduct } from "../../features/import-source-product/import-source-product.js";
export function assembleProductAuthoring(
  dependencies: ProductAuthoringDependencies,
) {
  return Object.freeze({
    loadHomePin: assembleLoadHomePin(dependencies),
    setHomePin: assembleSetHomePin(dependencies),
    createContentCollection: assembleCreateContentCollection(dependencies),
    updateContentCollection: assembleUpdateContentCollection(dependencies),
    setContentCollectionArchive:
      assembleSetContentCollectionArchive(dependencies),
    listContentCollections: assembleListContentCollections(dependencies),
    loadSeriesOrder: assembleLoadSeriesOrder(dependencies),
    reorderSeries: assembleReorderSeries(dependencies),
    updateChapterAttachments: assembleUpdateChapterAttachments(dependencies),
    reserveSourceProduct: assembleReserveSourceProduct(dependencies),
    validateSourceProduct: assembleValidateSourceProduct(dependencies),
    updateSourceProduct: assembleUpdateSourceProduct(dependencies),
    reorderSourceProduct: assembleReorderSourceProduct(dependencies),
  });
}
export type ProductAuthoring = ReturnType<typeof assembleProductAuthoring>;
export const PRODUCT_AUTHORING = Symbol("PRODUCT_AUTHORING");
