import type { CreateDraftOperation } from "../../features/create-draft/create-draft.contract.js";
import type { DeleteDraftOperation } from "../../features/delete-draft/delete-draft.contract.js";
import type { LoadMaterialOperation } from "../../features/load-material/load-material.contract.js";
import type { ListAuthoringReferencesOperation } from "../../features/list-authoring-references/list-authoring-references.contract.js";
import type { ListMaterialsOperation } from "../../features/list-materials/list-materials.contract.js";
import type { PreviewMaterialOperation } from "../../features/preview-material/preview-material.contract.js";
import type { LoadSeriesOrderOperation } from "../../features/load-series-order/load-series-order.contract.js";
import type { ReorderSeriesOperation } from "../../features/reorder-series/reorder-series.contract.js";
import type { SaveMaterialOperation } from "../../features/save-material/save-material.contract.js";
import type { ValidateMaterialOperation } from "../../features/validate-material/validate-material.contract.js";
import type { TransitionMaterialPublicationOperation } from "../../features/transition-material-publication/transition-material-publication.contract.js";
import type { CreateContentCollectionOperation } from "../../features/create-content-collection/create-content-collection.contract.js";
import type { ListContentCollectionsOperation } from "../../features/list-content-collections/list-content-collections.contract.js";
import type { SetContentCollectionArchiveOperation } from "../../features/set-content-collection-archive/set-content-collection-archive.contract.js";
import type { UpdateContentCollectionOperation } from "../../features/update-content-collection/update-content-collection.contract.js";

export interface MaterialAuthoring {
  readonly createContentCollection: CreateContentCollectionOperation;
  readonly createDraft: CreateDraftOperation;
  readonly deleteDraft: DeleteDraftOperation;
  readonly loadMaterial: LoadMaterialOperation;
  readonly loadSeriesOrder: LoadSeriesOrderOperation;
  readonly listReferences: ListAuthoringReferencesOperation;
  readonly listMaterials: ListMaterialsOperation;
  readonly listContentCollections: ListContentCollectionsOperation;
  readonly previewMaterial: PreviewMaterialOperation;
  readonly reorderSeries: ReorderSeriesOperation;
  readonly saveMaterial: SaveMaterialOperation;
  readonly setContentCollectionArchive: SetContentCollectionArchiveOperation;
  readonly transitionPublication: TransitionMaterialPublicationOperation;
  readonly validateMaterial: ValidateMaterialOperation;
  readonly updateContentCollection: UpdateContentCollectionOperation;
}
