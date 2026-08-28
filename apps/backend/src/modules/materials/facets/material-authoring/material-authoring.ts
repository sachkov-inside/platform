import type { CreateDraftOperation } from "../../features/create-draft/create-draft.contract.js";
import type { DeleteDraftOperation } from "../../features/delete-draft/delete-draft.contract.js";
import type { LoadMaterialOperation } from "../../features/load-material/load-material.contract.js";
import type { ListAuthoringReferencesOperation } from "../../features/list-authoring-references/list-authoring-references.contract.js";
import type { PreviewMaterialOperation } from "../../features/preview-material/preview-material.contract.js";
import type { SaveMaterialOperation } from "../../features/save-material/save-material.contract.js";
import type { ValidateMaterialOperation } from "../../features/validate-material/validate-material.contract.js";

export interface MaterialAuthoring {
  readonly createDraft: CreateDraftOperation;
  readonly deleteDraft: DeleteDraftOperation;
  readonly loadMaterial: LoadMaterialOperation;
  readonly listReferences: ListAuthoringReferencesOperation;
  readonly previewMaterial: PreviewMaterialOperation;
  readonly saveMaterial: SaveMaterialOperation;
  readonly validateMaterial: ValidateMaterialOperation;
}
