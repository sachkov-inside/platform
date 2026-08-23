import type { ContentAuthoring } from "./content-authoring.interface.js";
import type { ContentAuthoringDependencies } from "./content-authoring.dependencies.js";
import { createCreateDraft } from "./create-draft/create-draft.js";
import { createLoadDraft } from "./load-draft/load-draft.js";
import { createReviseDraft } from "./revise-draft/revise-draft.js";

export function createContentAuthoringImplementation(
  dependencies: ContentAuthoringDependencies,
): ContentAuthoring {
  return {
    createDraft: createCreateDraft(dependencies),
    loadDraft: createLoadDraft(dependencies),
    reviseDraft: createReviseDraft(dependencies),
  };
}
