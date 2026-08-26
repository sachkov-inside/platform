import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  RestoreRevisionError,
  RestoreRevisionOperation,
} from "./restore-revision.contract.js";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import { authorizeAuthor, type AuthorPolicy } from "../../ports/author-policy.js";
import {
  executeAuthoringTransaction,
  failure,
} from "../../shared/application-result.js";
import { fingerprintCommand } from "../../shared/canonical-command-fingerprint.js";
import {
  idempotencyKeySchema,
  materialIdSchema,
  materialRevisionIdSchema,
  parseCommand,
  principalId,
} from "../../shared/command-validation.js";
import { toMaterialRevisionDto } from "../../shared/material-revision-dto.js";
import { mapPostgresLifecycleError } from "../../shared/postgres-error-mapping.js";
import { requireMaterialRevision } from "../../shared/require-material-revision.js";
import { requireReferenceIntegrity } from "../../shared/reference-integrity.js";
import { executeIdempotentRevision } from "../../shared/idempotent-operation.js";
import { lockMaterialForLifecycleChange } from "../../infrastructure/postgres/material-locks.js";
import { loadMaterialRevision } from "../../infrastructure/postgres/material-revision-reader.js";
import {
  insertRevision,
  replaceCurrentRelations,
} from "../../infrastructure/postgres/revision-persistence.js";
import { materialRevisionId } from "../../domain/material-identifiers.js";
import {
  restoreMaterialRevision,
  type MaterialRevision,
} from "../../domain/material.js";

const restoreRevisionCommand = z
  .object({
    actor: principalId,
    idempotencyKey: idempotencyKeySchema,
    materialId: materialIdSchema,
    revisionId: materialRevisionIdSchema,
    baseRevisionId: materialRevisionIdSchema,
  })
  .strict();

interface Dependencies {
  readonly prisma: MaterialsPrismaClient;
  readonly materialBodyOperations: MaterialBodyOperations;
  readonly authorPolicy: AuthorPolicy;
}

export function assembleRestoreRevision(
  dependencies: Dependencies,
): RestoreRevisionOperation {
  return async (input) => {
    const parsed = parseCommand(restoreRevisionCommand, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const command = parsed.value;
    const authorization = await authorizeAuthor(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }
    const fingerprint = fingerprintCommand({ operation: "restore_revision", ...command });
    const result = await executeAuthoringTransaction<
      MaterialRevision,
      RestoreRevisionError
    >(
      dependencies.prisma,
      (transaction, rollback) =>
        executeIdempotentRevision(
          transaction,
          dependencies.materialBodyOperations,
          {
            actor: command.actor,
            operation: "restore_revision",
            key: command.idempotencyKey,
            fingerprint,
          },
          rollback,
          async () => {
            const material = await lockMaterialForLifecycleChange(
              transaction,
              command.materialId,
            );
            if (material === undefined) {
              return rollback({ code: "material_not_found" });
            }
            const revisionId = materialRevisionId(randomUUID());
            const transition = material.advanceDraft(
              command.baseRevisionId,
              revisionId,
            );
            if (!transition.ok) {
              return rollback(transition.error);
            }
            const source = await loadMaterialRevision(
              transaction,
              dependencies.materialBodyOperations,
              command.materialId,
              command.revisionId,
            );
            if (source === undefined) {
              return rollback({ code: "revision_not_found" });
            }
            if (!source.ok) {
              return rollback({
                code: "internal_error",
                correlationId: randomUUID(),
              });
            }
            await requireReferenceIntegrity(
              transaction,
              command.materialId,
              source.value.metadata,
              rollback,
            );
            const restoredRevision = restoreMaterialRevision(
              source.value,
              transition.value.currentDraftRevisionId,
            );
            await insertRevision(transaction, {
              actor: command.actor,
              materialId: restoredRevision.materialId,
              revisionId: restoredRevision.id,
              ...(restoredRevision.restoredFromRevisionId === undefined
                ? {}
                : {
                    restoredFromRevisionId:
                      restoredRevision.restoredFromRevisionId,
                  }),
              metadata: restoredRevision.metadata,
              schemaVersion: restoredRevision.body.schemaVersion,
              body: restoredRevision.body.doc,
            });
            await transaction.material.updateMany({
              where: {
                id: command.materialId,
                currentDraftRevisionId: command.baseRevisionId,
              },
              data: {
                currentDraftRevisionId: transition.value.currentDraftRevisionId,
                slug: restoredRevision.metadata.slug,
                updatedAt: new Date(),
              },
            });
            await replaceCurrentRelations(
              transaction,
              command.materialId,
              restoredRevision.metadata,
            );
            return requireMaterialRevision(
              transaction,
              dependencies.materialBodyOperations,
              command.materialId,
              restoredRevision.id,
              rollback,
            );
          },
        ),
      mapPostgresLifecycleError,
    );
    return result.ok
      ? { ok: true, value: toMaterialRevisionDto(result.value) }
      : result;
  };
}
