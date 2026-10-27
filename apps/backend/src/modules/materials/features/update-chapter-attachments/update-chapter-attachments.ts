export { chapterAttachmentsBodySchema } from "../../../products/index.js";
export type { UpdateChapterAttachmentsOperation } from "../../../products/index.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
export function assembleUpdateChapterAttachments(
  dependencies: MaterialAuthoringDependencies,
) {
  return dependencies.products.updateChapterAttachments;
}
