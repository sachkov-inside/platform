import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  LoadDraftOperation,
} from "./load-draft.contract.js";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import { authorizeAuthor, type AuthorPolicy } from "../../ports/author-policy.js";
import { failure } from "../../shared/application-result.js";
import {
  materialIdSchema,
  parseCommand,
  principalId,
} from "../../shared/command-validation.js";
import { toMaterialRevisionDto } from "../../shared/material-revision-dto.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { loadCurrentDraftRevision } from "../../infrastructure/postgres/material-revision-reader.js";

const loadDraftQuery = z
  .object({
    actor: principalId,
    materialId: materialIdSchema,
  })
  .strict();

interface Dependencies {
  readonly prisma: MaterialsPrismaClient;
  readonly materialBodyOperations: MaterialBodyOperations;
  readonly authorPolicy: AuthorPolicy;
}

export function assembleLoadDraft(
  dependencies: Dependencies,
): LoadDraftOperation {
  return async (input) => {
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
        dependencies.prisma,
        dependencies.materialBodyOperations,
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
