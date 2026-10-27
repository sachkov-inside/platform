import type { ReadHistoricalSourceMaterialReceipt } from "../../features/read-historical-source-receipt/read-historical-source-receipt.js";
import type { UpdateChapterAttachmentsOperation } from "../../features/update-chapter-attachments/update-chapter-attachments.js";
import type { ReadHistoricalPracticeReceiptOperation } from "../../features/import-source-practice/import-source-practice.contract.js";
import type {
  ReserveSourceProductOperation,
  UpdateSourceProductOperation,
  ReorderSourceProductOperation,
  ValidateSourceProductOperation,
} from "../../features/import-source-product/import-source-product.contract.js";
import type { ValidateSourceOperation } from "../../features/import-source-material/import-source-material.contract.js";
import type {
  SourcePublicationOperation,
  ReserveSourceOperation,
  ApplySourceOperation,
} from "../../features/import-source-material/import-source-material.contract.js";
import type { ReadSourceMaterialStateOperation } from "../../features/read-source-material-state/read-source-material-state.contract.js";
import type { LoadHomePinOperation } from "../../features/load-home-pin/load-home-pin.contract.js";
import type { SetHomePinOperation } from "../../features/set-home-pin/set-home-pin.contract.js";
import type { CreateDraftOperation } from "../../features/create-draft/create-draft.contract.js";
import type { DeleteDraftOperation } from "../../features/delete-draft/delete-draft.contract.js";
import type { LoadMaterialOperation } from "../../features/load-material/load-material.contract.js";
import type { ListAuthoringReferencesOperation } from "../../features/list-authoring-references/list-authoring-references.contract.js";
import type { ListMaterialsOperation } from "../../features/list-materials/list-materials.contract.js";
import type { SearchAuthoringMaterialsOperation } from "../../features/search-authoring-content/search-authoring-content.contract.js";
import type { PreviewMaterialOperation } from "../../features/preview-material/preview-material.contract.js";
import type { LoadProductOrderOperation } from "../../features/load-product-order/load-product-order.contract.js";
import type { ReorderProductOperation } from "../../features/reorder-product/reorder-product.contract.js";
import type { SaveMaterialOperation } from "../../features/save-material/save-material.contract.js";
import type { ValidateMaterialOperation } from "../../features/validate-material/validate-material.contract.js";
import type { TransitionMaterialPublicationOperation } from "../../features/transition-material-publication/transition-material-publication.contract.js";
import type { CreateContentCollectionOperation } from "../../features/create-content-collection/create-content-collection.contract.js";
import type { ListContentCollectionsOperation } from "../../features/list-content-collections/list-content-collections.contract.js";
import type { SetContentCollectionArchiveOperation } from "../../features/set-content-collection-archive/set-content-collection-archive.contract.js";
import type { UpdateContentCollectionOperation } from "../../features/update-content-collection/update-content-collection.contract.js";

export interface MaterialAuthoring {
  readonly readHistoricalSourceMaterialReceipt: ReadHistoricalSourceMaterialReceipt;
  readonly updateChapterAttachments: UpdateChapterAttachmentsOperation;
  readonly readHistoricalPracticeReceipt: ReadHistoricalPracticeReceiptOperation;
  readonly reserveSourceProduct: ReserveSourceProductOperation;
  readonly validateSourceProduct: ValidateSourceProductOperation;
  readonly updateSourceProduct: UpdateSourceProductOperation;
  readonly reorderSourceProduct: ReorderSourceProductOperation;
  readonly validateSourceContent: ValidateSourceOperation;
  readonly reserveSourceMaterial: ReserveSourceOperation;
  readonly transitionSourcePublication: SourcePublicationOperation;
  readonly applySourceMaterial: ApplySourceOperation;
  readonly readSourceMaterialState: ReadSourceMaterialStateOperation;
  readonly loadHomePin: LoadHomePinOperation;
  readonly setHomePin: SetHomePinOperation;
  readonly createContentCollection: CreateContentCollectionOperation;
  readonly createDraft: CreateDraftOperation;
  readonly deleteDraft: DeleteDraftOperation;
  readonly loadMaterial: LoadMaterialOperation;
  readonly loadProductOrder: LoadProductOrderOperation;
  readonly listReferences: ListAuthoringReferencesOperation;
  readonly listMaterials: ListMaterialsOperation;
  readonly listContentCollections: ListContentCollectionsOperation;
  /** The Materials group of the authoring search (#1720). */
  readonly searchMaterials: SearchAuthoringMaterialsOperation;
  readonly previewMaterial: PreviewMaterialOperation;
  readonly reorderProduct: ReorderProductOperation;
  readonly saveMaterial: SaveMaterialOperation;
  readonly setContentCollectionArchive: SetContentCollectionArchiveOperation;
  readonly transitionPublication: TransitionMaterialPublicationOperation;
  readonly validateMaterial: ValidateMaterialOperation;
  readonly updateContentCollection: UpdateContentCollectionOperation;
}
