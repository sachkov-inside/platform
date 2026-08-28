import { assembleCreateDraft } from "../../features/create-draft/create-draft.js";
import { assembleDeleteDraft } from "../../features/delete-draft/delete-draft.js";
import { assembleLoadMaterial } from "../../features/load-material/load-material.js";
import { assembleListAuthoringReferences } from "../../features/list-authoring-references/list-authoring-references.js";
import { assemblePreviewMaterial } from "../../features/preview-material/preview-material.js";
import { assembleSaveMaterial } from "../../features/save-material/save-material.js";
import { assembleValidateMaterial } from "../../features/validate-material/validate-material.js";
import type { MaterialAuthoringDependencies } from "./material-authoring.dependencies.js";
import type { MaterialAuthoring } from "./material-authoring.js";

export function assembleMaterialAuthoring(
  dependencies: MaterialAuthoringDependencies,
): MaterialAuthoring {
  return {
    createDraft: assembleCreateDraft(dependencies),
    deleteDraft: assembleDeleteDraft(dependencies),
    loadMaterial: assembleLoadMaterial(dependencies),
    listReferences: assembleListAuthoringReferences(dependencies),
    previewMaterial: assemblePreviewMaterial(dependencies),
    saveMaterial: assembleSaveMaterial(dependencies),
    validateMaterial: assembleValidateMaterial(dependencies),
  };
}
