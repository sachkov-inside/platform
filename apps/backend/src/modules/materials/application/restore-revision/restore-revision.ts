import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  MaterialAuthoring,
  RestoreRevisionError,
} from "../material-authoring.interface.js";
import type { MaterialAuthoringDependencies } from "../material-authoring.dependencies.js";
import { authorizeAuthor } from "../ports/author-policy.js";
import {
  failure,
  failureFromTransaction,
  rollback,
} from "../shared/application-result.js";
import { fingerprintCommand } from "../shared/canonical-command-fingerprint.js";
import {
  idempotencyKeySchema,
  materialIdSchema,
  materialRevisionIdSchema,
  parseCommand,
  principalId,
} from "../shared/command-validation.js";
import { toMaterialRevisionDto } from "../shared/material-revision-dto.js";
import { mapPostgresError } from "../shared/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "../shared/reference-integrity.js";
import {
  claimIdempotency,
  completeIdempotency,
} from "../../infrastructure/postgres/idempotency.js";
import {
  lockMaterialForLifecycleChange,
  loadMaterialRevision,
} from "../../infrastructure/postgres/material-persistence.js";
import {
  insertRevision,
  replaceCurrentRelations,
} from "../../infrastructure/postgres/revision-persistence.js";
import {
  materialId,
  materialRevisionId,
} from "../../domain/material-identifiers.js";

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
): MaterialAuthoring["restoreRevision"] {
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
    try {
      const revision = await dependencies.database.transaction().execute(async (transaction) => {
        const claim = await claimIdempotency(transaction, {
          actor: command.actor,
          operation: "restore_revision",
          key: command.idempotencyKey,
          fingerprint,
        });
        if (claim.kind === "reused") {
          rollback({ code: "idempotency_key_reused" });
        }
        if (claim.kind === "incomplete") {
          rollback({ code: "dependency_unavailable", retryable: true });
        }
        if (claim.kind === "replay") {
          const replay = await loadMaterialRevision(
            transaction,
            dependencies.materialBodyOperations,
            materialId(claim.materialId),
            materialRevisionId(claim.revisionId),
          );
          if (replay === undefined || !replay.ok) {
            rollback({ code: "internal_error", correlationId: randomUUID() });
          }
          return replay.value;
        }

        const material = await lockMaterialForLifecycleChange(
          transaction,
          command.materialId,
        );
        if (material === undefined) {
          rollback({ code: "material_not_found" });
        }
        const revisionId = materialRevisionId(randomUUID());
        const transition = material.advanceDraft(
          command.baseRevisionId,
          revisionId,
        );
        if (!transition.ok) {
          rollback(transition.error);
        }
        const source = await loadMaterialRevision(
          transaction,
          dependencies.materialBodyOperations,
          command.materialId,
          command.revisionId,
        );
        if (source === undefined) {
          rollback({ code: "revision_not_found" });
        }
        if (!source.ok) {
          rollback({ code: "internal_error", correlationId: randomUUID() });
        }
        await requireReferenceIntegrity(
          transaction,
          command.materialId,
          source.value.metadata,
        );
        const restoredRevision = source.value.restoreAs(
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
            current_draft_revision_id: transition.value.currentDraftRevisionId,
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
        await completeIdempotency(transaction, {
          actor: command.actor,
          operation: "restore_revision",
          key: command.idempotencyKey,
          materialId: command.materialId,
          revisionId: restoredRevision.id,
        });
        const restored = await loadMaterialRevision(
          transaction,
          dependencies.materialBodyOperations,
          command.materialId,
          restoredRevision.id,
        );
        if (restored === undefined || !restored.ok) {
          rollback({ code: "internal_error", correlationId: randomUUID() });
        }
        return restored.value;
      });
      return { ok: true, value: toMaterialRevisionDto(revision) };
    } catch (error) {
      return failureFromTransaction<RestoreRevisionError>(
        error,
        mapPostgresError,
      );
    }
  };
}
