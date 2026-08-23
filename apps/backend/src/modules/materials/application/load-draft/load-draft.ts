import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  MaterialAuthoring,
  LoadDraftQuery,
} from "../material-authoring.interface.js";
import { authorizeAuthor } from "../ports/author-policy.js";
import type { MaterialAuthoringDependencies } from "../material-authoring.dependencies.js";
import { failure } from "../shared/application-result.js";
import {
  materialIdSchema,
  parseCommand,
  principalId,
} from "../shared/command-validation.js";
import { toMaterialRevisionDto } from "../shared/material-revision-dto.js";
import { mapPostgresReadError } from "../shared/postgres-error-mapping.js";
import { loadCurrentDraftRevision } from "../../infrastructure/postgres/material-persistence.js";

const loadDraftQuery = z
  .object({
    actor: principalId,
    materialId: materialIdSchema,
  })
  .strict();

export function createLoadDraft(
  dependencies: MaterialAuthoringDependencies,
): MaterialAuthoring["loadDraft"] {
  return async (input: LoadDraftQuery) => {
    const parsedQuery = parseCommand(loadDraftQuery, input);
    if (!parsedQuery.ok) {
      return failure(parsedQuery.error);
    }
    const query = parsedQuery.value;
    const authorization = await authorizeAuthor(
      dependencies.authorPolicy,
      query.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }

    try {
      const revision = await loadCurrentDraftRevision(
        dependencies.database,
        dependencies.materialDocumentOperations,
        query.materialId,
      );
      if (revision === undefined) {
        return failure({ code: "material_not_found" });
      }
      return revision.ok
        ? {
            ok: true,
            value: toMaterialRevisionDto(revision.value),
          }
        : failure({ code: "internal_error", correlationId: randomUUID() });
    } catch (error) {
      return failure(mapPostgresReadError(error));
    }
  };
}
