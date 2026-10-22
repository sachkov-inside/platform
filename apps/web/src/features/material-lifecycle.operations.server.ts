/** Focused server interface for Material lifecycle contract tests. */
export {
  deleteMaterialDraftInvalidInput,
  executeDeleteMaterialDraft,
} from "./material-lifecycle/api/delete-material-draft";
export {
  deleteMaterialDraftOperation,
  transitionMaterialPublicationOperation,
} from "./material-lifecycle/api/material-lifecycle.operation";
export {
  executeTransitionMaterialPublication,
  transitionMaterialPublicationInvalidInput,
} from "./material-lifecycle/api/transition-material-publication";
