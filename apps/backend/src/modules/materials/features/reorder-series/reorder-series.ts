export { reorderSeriesCommandSchema } from "../../../products/index.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
export function assembleReorderSeries(
  dependencies: MaterialAuthoringDependencies,
) {
  return dependencies.products.reorderSeries;
}
