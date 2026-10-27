export { reorderProductCommandSchema } from "../../../products/index.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
export function assembleReorderProduct(
  dependencies: MaterialAuthoringDependencies,
) {
  return dependencies.products.reorderProduct;
}
