import { assembleCreateDraft } from "../../features/create-draft/create-draft.js";
import { assembleLoadDraft } from "../../features/load-draft/load-draft.js";
import { assemblePreviewRevision } from "../../features/preview-revision/preview-revision.js";
import { assemblePublishRevision } from "../../features/publish-revision/publish-revision.js";
import { assembleRestoreRevision } from "../../features/restore-revision/restore-revision.js";
import { assembleReviseDraft } from "../../features/revise-draft/revise-draft.js";
import { assembleUnpublishMaterial } from "../../features/unpublish-material/unpublish-material.js";
import { assembleValidateRevision } from "../../features/validate-revision/validate-revision.js";
import type { MaterialAuthoringDependencies } from "./material-authoring.dependencies.js";
import type { MaterialAuthoring } from "./material-authoring.js";

export function assembleMaterialAuthoring(
  dependencies: MaterialAuthoringDependencies,
): MaterialAuthoring {
  return {
    createDraft: assembleCreateDraft(dependencies),
    loadDraft: assembleLoadDraft(dependencies),
    previewRevision: assemblePreviewRevision(dependencies),
    publishRevision: assemblePublishRevision(dependencies),
    restoreRevision: assembleRestoreRevision(dependencies),
    reviseDraft: assembleReviseDraft(dependencies),
    unpublishMaterial: assembleUnpublishMaterial(dependencies),
    validateRevision: assembleValidateRevision(dependencies),
  };
}
