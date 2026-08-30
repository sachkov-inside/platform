import type { MaterialAuthoring } from "../../src/modules/materials/index.js";

export const forbiddenAuthoringResult = {
  ok: false as const,
  error: { code: "forbidden" as const },
};

export function stubMaterialAuthoring(
  overrides: Partial<MaterialAuthoring> = {},
): MaterialAuthoring {
  return {
    createDraft: () => Promise.resolve(forbiddenAuthoringResult),
    deleteDraft: () => Promise.resolve(forbiddenAuthoringResult),
    listReferences: () => Promise.resolve(forbiddenAuthoringResult),
    loadMaterial: () => Promise.resolve(forbiddenAuthoringResult),
    previewMaterial: () => Promise.resolve(forbiddenAuthoringResult),
    saveMaterial: () => Promise.resolve(forbiddenAuthoringResult),
    validateMaterial: () => Promise.resolve(forbiddenAuthoringResult),
    ...overrides,
  };
}
