import type { MaterialAuthoring } from "../../src/modules/materials/index.js";

export const forbiddenAuthoringResult = {
  ok: false as const,
  error: { code: "forbidden" as const },
};

export function stubMaterialAuthoring(
  overrides: Partial<MaterialAuthoring> = {},
): MaterialAuthoring {
  return {
    createContentCollection: () => Promise.resolve(forbiddenAuthoringResult),
    createDraft: () => Promise.resolve(forbiddenAuthoringResult),
    deleteDraft: () => Promise.resolve(forbiddenAuthoringResult),
    listContentCollections: () => Promise.resolve(forbiddenAuthoringResult),
    listReferences: () => Promise.resolve(forbiddenAuthoringResult),
    listMaterials: () => Promise.resolve(forbiddenAuthoringResult),
    loadMaterial: () => Promise.resolve(forbiddenAuthoringResult),
    loadSeriesOrder: () => Promise.resolve(forbiddenAuthoringResult),
    previewMaterial: () => Promise.resolve(forbiddenAuthoringResult),
    reorderSeries: () => Promise.resolve(forbiddenAuthoringResult),
    saveMaterial: () => Promise.resolve(forbiddenAuthoringResult),
    setContentCollectionArchive: () =>
      Promise.resolve(forbiddenAuthoringResult),
    transitionPublication: () => Promise.resolve(forbiddenAuthoringResult),
    updateContentCollection: () => Promise.resolve(forbiddenAuthoringResult),
    validateMaterial: () => Promise.resolve(forbiddenAuthoringResult),
    ...overrides,
  };
}
