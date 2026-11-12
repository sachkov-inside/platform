export { productTopicsBodySchema } from "../../../products/index.js";
export type { UpdateProductTopicsOperation } from "../../../products/index.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
export function assembleUpdateProductTopics(
  dependencies: MaterialAuthoringDependencies,
) {
  return dependencies.products.updateProductTopics;
}
