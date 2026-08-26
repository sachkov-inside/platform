import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  Prisma,
  type MaterialsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import { materialRevisionId } from "../../domain/material-identifiers.js";
import { loadMaterialRevision } from "../../infrastructure/postgres/material-revision-reader.js";
import { authorizeAuthor, type AuthorPolicy } from "../../ports/author-policy.js";
import {
  executeAuthoringTransaction,
  failure,
} from "../../shared/application-result.js";
import { fingerprintCommand } from "../../shared/canonical-command-fingerprint.js";
import {
  materialIdSchema,
  materialRevisionIdSchema,
  parseCommand,
  principalId,
} from "../../shared/command-validation.js";
import { mapPostgresValidationError } from "../../shared/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "../../shared/reference-integrity.js";
import type {
  ValidateRevisionError,
  ValidateRevisionOperation,
  ValidatedRevisionDto,
} from "./validate-revision.contract.js";

const currentDraftRowsSchema = z.array(
  z.object({ current_draft_revision_id: z.uuid() }),
);

export const validateRevisionQuery = z
  .object({
    actor: principalId,
    materialId: materialIdSchema,
    revisionId: materialRevisionIdSchema,
  })
  .strict();

interface Dependencies {
  readonly prisma: MaterialsPrismaClient;
  readonly materialBodyOperations: MaterialBodyOperations;
  readonly authorPolicy: AuthorPolicy;
}

export function assembleValidateRevision(
  dependencies: Dependencies,
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
      dependencies.prisma,
      async (transaction, rollback) => {
        const currentRevisionRows = currentDraftRowsSchema.parse(
          await transaction.$queryRaw(Prisma.sql`
            select current_draft_revision_id
            from materials.materials
            where id = ${query.materialId}::uuid
            for share
          `),
        );
        const currentRevisionId =
          currentRevisionRows[0] === undefined
            ? undefined
            : materialRevisionId(
                currentRevisionRows[0].current_draft_revision_id,
              );
        if (currentRevisionId === undefined) {
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
        if (currentRevisionId !== query.revisionId) {
          return rollback({
            code: "stale_revision",
            currentRevisionId: materialRevisionId(currentRevisionId),
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
