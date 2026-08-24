import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  ValidateRevisionError,
  ValidateRevisionOperation,
  ValidatedRevisionDto,
} from "./material-authoring.interface.js";
import type { MaterialAuthoringDependencies } from "./material-authoring.dependencies.js";
import { authorizeAuthor } from "./ports/author-policy.js";
import {
  executeAuthoringTransaction,
  failure,
} from "./shared/application-result.js";
import { fingerprintCommand } from "./shared/canonical-command-fingerprint.js";
import {
  materialIdSchema,
  materialRevisionIdSchema,
  parseCommand,
  principalId,
} from "./shared/command-validation.js";
import { mapPostgresValidationError } from "./shared/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "./shared/reference-integrity.js";
import { loadMaterialRevision } from "../infrastructure/postgres/material-persistence.js";
import { materialRevisionId } from "../domain/material-identifiers.js";

export const validateRevisionQuery = z
  .object({
    actor: principalId,
    materialId: materialIdSchema,
    revisionId: materialRevisionIdSchema,
  })
  .strict();

export function createValidateRevision(
  dependencies: MaterialAuthoringDependencies,
): ValidateRevisionOperation {
  return async (input) => {
    const parsed = parseCommand(validateRevisionQuery, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const query = parsed.value;
    const authorization = await authorizeAuthor(
      dependencies.authorPolicy,
      query.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }
    return executeAuthoringTransaction<
      ValidatedRevisionDto,
      ValidateRevisionError
    >(
      dependencies.database,
      async (transaction, rollback) => {
          const material = await transaction
            .selectFrom("materials")
            .select("current_draft_revision_id")
            .where("id", "=", query.materialId)
            .forShare()
            .executeTakeFirst();
          if (material === undefined) {
            return rollback({ code: "material_not_found" });
          }
          const revision = await loadMaterialRevision(
            transaction,
            dependencies.materialBodyOperations,
            query.materialId,
            query.revisionId,
          );
          if (revision === undefined) {
            return rollback({ code: "revision_not_found" });
          }
          if (!revision.ok) {
            return rollback({
              code: "internal_error",
              correlationId: randomUUID(),
            });
          }
          await requireReferenceIntegrity(
            transaction,
            query.materialId,
            revision.value.metadata,
            rollback,
          );
          if (material.current_draft_revision_id !== query.revisionId) {
            return rollback({
              code: "stale_revision",
              currentRevisionId: materialRevisionId(
                material.current_draft_revision_id,
              ),
            });
          }
          const extraction = dependencies.materialBodyOperations.extract(
            revision.value.body,
          );
          if (!extraction.ok) {
            return rollback(extraction.error);
          }
          return {
            materialId: revision.value.materialId,
            revisionId: revision.value.id,
            projectionDigest: fingerprintCommand({
              metadata: revision.value.metadata.toValues(),
              extraction: extraction.value,
            }),
            extraction: extraction.value,
          };
      },
      mapPostgresValidationError,
    );
  };
}
