import { assembleCreateDraft } from "../../features/create-draft/create-draft.js";
import { assembleDeleteDraft } from "../../features/delete-draft/delete-draft.js";
import { assembleLoadMaterial } from "../../features/load-material/load-material.js";
import { assembleLoadSeriesOrder } from "../../features/load-series-order/load-series-order.js";
import { assembleListAuthoringReferences } from "../../features/list-authoring-references/list-authoring-references.js";
import { assembleListMaterials } from "../../features/list-materials/list-materials.js";
import { assemblePreviewMaterial } from "../../features/preview-material/preview-material.js";
import { assembleReorderSeries } from "../../features/reorder-series/reorder-series.js";
import { assembleSaveMaterial } from "../../features/save-material/save-material.js";
import { assembleValidateMaterial } from "../../features/validate-material/validate-material.js";
import { assembleTransitionMaterialPublication } from "../../features/transition-material-publication/transition-material-publication.js";
import type { MaterialAuthoringDependencies } from "./material-authoring.dependencies.js";
import type { MaterialAuthoring } from "./material-authoring.js";
import { assembleCreateContentCollection } from "../../features/create-content-collection/create-content-collection.js";
import { assembleListContentCollections } from "../../features/list-content-collections/list-content-collections.js";
import { assembleSetContentCollectionArchive } from "../../features/set-content-collection-archive/set-content-collection-archive.js";
import { assembleUpdateContentCollection } from "../../features/update-content-collection/update-content-collection.js";

export function assembleMaterialAuthoring(
  dependencies: MaterialAuthoringDependencies,
): MaterialAuthoring {
  const loadMaterial = assembleLoadMaterial(dependencies);
  const saveMaterial = assembleSaveMaterial(dependencies);
  return {
    createContentCollection: assembleCreateContentCollection(dependencies),
    createDraft: assembleCreateDraft(dependencies),
    deleteDraft: assembleDeleteDraft(dependencies),
    loadMaterial,
    loadSeriesOrder: assembleLoadSeriesOrder(dependencies),
    listReferences: assembleListAuthoringReferences(dependencies),
    listMaterials: assembleListMaterials(dependencies),
    listContentCollections: assembleListContentCollections(dependencies),
    previewMaterial: assemblePreviewMaterial(dependencies),
    reorderSeries: assembleReorderSeries(dependencies),
    saveMaterial,
    setContentCollectionArchive:
      assembleSetContentCollectionArchive(dependencies),
    transitionPublication: assembleTransitionMaterialPublication({
      loadMaterial,
      saveMaterial,
    }),
    validateMaterial: assembleValidateMaterial(dependencies),
    updateContentCollection: assembleUpdateContentCollection(dependencies),
  };
}
