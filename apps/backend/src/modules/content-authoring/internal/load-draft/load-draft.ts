import { z } from "zod";

import type {
  ContentAuthoring,
  LoadDraftQuery,
} from "../../content-authoring.interface.js";
import { canAuthor } from "../author-policy.js";
import type { ContentAuthoringDependencies } from "../content-authoring.dependencies.js";
import { failure } from "../shared/application-result.js";
import {
  entityId,
  parseCommand,
  principalId,
} from "../shared/command-validation.js";
import {
  hydratePersistedDraft,
  loadPersistedDraft,
} from "../shared/draft-snapshot.js";
import { mapPostgresError } from "../shared/postgres-error-mapping.js";

const loadDraftQuery = z
  .object({
    actor: principalId,
    materialId: entityId,
  })
  .strict();

export function createLoadDraft(
  dependencies: ContentAuthoringDependencies,
): ContentAuthoring["loadDraft"] {
  return async (input: LoadDraftQuery) => {
    const parsedQuery = parseCommand(loadDraftQuery, input);
    if (!parsedQuery.ok) {
      return failure(parsedQuery.error);
    }
    const query = parsedQuery.value;
    if (!(await canAuthor(dependencies.authorPolicy, query.actor))) {
      return failure({ code: "forbidden" });
    }

    try {
      const persisted = await loadPersistedDraft(
        dependencies.database,
        query.materialId,
      );
      if (persisted === undefined) {
        return failure({ code: "material_not_found" });
      }
      const draft = hydratePersistedDraft(dependencies.contentSchema, persisted);
      return draft.ok ? draft : failure(draft.error);
    } catch (error) {
      return failure(mapPostgresError(error));
    }
  };
}
