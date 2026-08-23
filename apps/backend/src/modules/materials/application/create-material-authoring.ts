import type { MaterialAuthoring } from "./material-authoring.interface.js";
import type { MaterialAuthoringDependencies } from "./material-authoring.dependencies.js";
import { createCreateDraft } from "./create-draft/create-draft.js";
import { createLoadDraft } from "./load-draft/load-draft.js";
import { createReviseDraft } from "./revise-draft/revise-draft.js";
import { createValidateRevision } from "./validate-revision/validate-revision.js";
import { createPreviewRevision } from "./preview-revision/preview-revision.js";
import { createPublishRevision } from "./publish-revision/publish-revision.js";
import { createRestoreRevision } from "./restore-revision/restore-revision.js";
import { createUnpublishMaterial } from "./unpublish-material/unpublish-material.js";

export function createMaterialAuthoringImplementation(
  dependencies: MaterialAuthoringDependencies,
): MaterialAuthoring {
  return {
    createDraft: createCreateDraft(dependencies),
    loadDraft: createLoadDraft(dependencies),
    previewRevision: createPreviewRevision(dependencies),
    publishRevision: createPublishRevision(dependencies),
    restoreRevision: createRestoreRevision(dependencies),
    reviseDraft: createReviseDraft(dependencies),
    unpublishMaterial: createUnpublishMaterial(dependencies),
    validateRevision: createValidateRevision(dependencies),
  };
}
