import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  ContentAuthoring,
  LoadDraftQuery,
} from "../content-authoring.interface.js";
import { canAuthor } from "../ports/author-policy.js";
import type { ContentAuthoringDependencies } from "../content-authoring.dependencies.js";
import { failure } from "../shared/application-result.js";
import {
  entityId,
  parseCommand,
  principalId,
} from "../shared/command-validation.js";
import { toMaterialDraftDto } from "../shared/material-draft-dto.js";
import { mapPostgresError } from "../shared/postgres-error-mapping.js";
import { loadCurrentMaterial } from "../../infrastructure/postgres/material-persistence.js";

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
      const material = await loadCurrentMaterial(
        dependencies.database,
        dependencies.materialDocument,
        query.materialId,
      );
      if (material === undefined) {
        return failure({ code: "material_not_found" });
      }
      return material.ok
        ? {
            ok: true,
            value: toMaterialDraftDto(material.value.currentDraft),
          }
        : failure({ code: "internal_error", correlationId: randomUUID() });
    } catch (error) {
      return failure(mapPostgresError(error));
    }
  };
}
