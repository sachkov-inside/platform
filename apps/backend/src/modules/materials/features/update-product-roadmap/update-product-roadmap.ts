export {
  productRoadmapBodySchema,
  productRoadmapReceiptSchema,
} from "../../../products/index.js";
export type {
  LoadProductRoadmapOperation,
  UpdateProductRoadmapOperation,
} from "../../../products/index.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";

export function assembleLoadProductRoadmap(
  dependencies: MaterialAuthoringDependencies,
) {
  return dependencies.products.loadProductRoadmap;
}

export function assembleUpdateProductRoadmap(
  dependencies: MaterialAuthoringDependencies,
) {
  return dependencies.products.updateProductRoadmap;
}
