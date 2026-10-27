import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
export function assembleLoadProductOrder(
  dependencies: MaterialAuthoringDependencies,
) {
  return dependencies.products.loadProductOrder;
}
