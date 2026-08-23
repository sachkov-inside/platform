import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  RestoreRevisionError,
  RestoreRevisionOperation,
} from "./material-authoring.interface.js";
import type { MaterialAuthoringDependencies } from "./material-authoring.dependencies.js";
import { authorizeAuthor } from "./ports/author-policy.js";
import {
  executeAuthoringTransaction,
  failure,
} from "./shared/application-result.js";
import { fingerprintCommand } from "./shared/canonical-command-fingerprint.js";
import {
  idempotencyKeySchema,
  materialIdSchema,
  materialRevisionIdSchema,
  parseCommand,
  principalId,
} from "./shared/command-validation.js";
import { toMaterialRevisionDto } from "./shared/material-revision-dto.js";
import { mapPostgresLifecycleError } from "./shared/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "./shared/reference-integrity.js";
import { executeIdempotentRevision } from "./shared/idempotent-operation.js";
import {
  lockMaterialForLifecycleChange,
  loadMaterialRevision,
} from "../infrastructure/postgres/material-persistence.js";
import {
  insertRevision,
  replaceCurrentRelations,
} from "../infrastructure/postgres/revision-persistence.js";
import { materialRevisionId } from "../domain/material-identifiers.js";
import {
  restoreMaterialRevision,
  type MaterialRevision,
} from "../domain/material.js";

const restoreRevisionCommand = z
  .object({
    actor: principalId,
    idempotencyKey: idempotencyKeySchema,
    materialId: materialIdSchema,
    revisionId: materialRevisionIdSchema,
    baseRevisionId: materialRevisionIdSchema,
  })
  .strict();

export function createRestoreRevision(
  dependencies: MaterialAuthoringDependencies,
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
      dependencies.database,
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
              restoredFromRevisionId: restoredRevision.restoredFromRevisionId,
              metadata: restoredRevision.metadata,
              schemaVersion: restoredRevision.body.schemaVersion,
              body: restoredRevision.body.doc,
            });
            await transaction
              .updateTable("materials")
              .set({
                current_draft_revision_id:
                  transition.value.currentDraftRevisionId,
                slug: restoredRevision.metadata.slug,
                updated_at: new Date(),
              })
              .where("id", "=", command.materialId)
              .where("current_draft_revision_id", "=", command.baseRevisionId)
              .executeTakeFirstOrThrow();
            await replaceCurrentRelations(
              transaction,
              command.materialId,
              restoredRevision.metadata,
            );
            const restored = await loadMaterialRevision(
              transaction,
              dependencies.materialBodyOperations,
              command.materialId,
              restoredRevision.id,
            );
            if (restored === undefined || !restored.ok) {
              return rollback({
                code: "internal_error",
                correlationId: randomUUID(),
              });
            }
            return restored.value;
          },
        ),
      mapPostgresLifecycleError,
    );
    return result.ok
      ? { ok: true, value: toMaterialRevisionDto(result.value) }
      : result;
  };
}
