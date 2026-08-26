import type { CreateDraftOperation } from "../../features/create-draft/create-draft.contract.js";
import type { LoadDraftOperation } from "../../features/load-draft/load-draft.contract.js";
import type { PreviewRevisionOperation } from "../../features/preview-revision/preview-revision.contract.js";
import type { PublishRevisionOperation } from "../../features/publish-revision/publish-revision.contract.js";
import type { RestoreRevisionOperation } from "../../features/restore-revision/restore-revision.contract.js";
import type { ReviseDraftOperation } from "../../features/revise-draft/revise-draft.contract.js";
import type { UnpublishMaterialOperation } from "../../features/unpublish-material/unpublish-material.contract.js";
import type { ValidateRevisionOperation } from "../../features/validate-revision/validate-revision.contract.js";

export interface MaterialAuthoring {
  readonly createDraft: CreateDraftOperation;
  readonly loadDraft: LoadDraftOperation;
  readonly reviseDraft: ReviseDraftOperation;
  readonly validateRevision: ValidateRevisionOperation;
  readonly previewRevision: PreviewRevisionOperation;
  readonly publishRevision: PublishRevisionOperation;
  readonly restoreRevision: RestoreRevisionOperation;
  readonly unpublishMaterial: UnpublishMaterialOperation;
}
