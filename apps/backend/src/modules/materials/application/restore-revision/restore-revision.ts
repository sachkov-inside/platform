import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { ContentAuthoring } from "../content-authoring.interface.js";
import type { ContentAuthoringDependencies } from "../content-authoring.dependencies.js";
import { canAuthor } from "../ports/author-policy.js";
import { AuthoringRollback, failure, rollback } from "../shared/application-result.js";
import { fingerprintCommand } from "../shared/canonical-command-fingerprint.js";
import {
  entityId,
  idempotencyKey,
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
  loadMaterialRevision,
} from "../../infrastructure/postgres/material-persistence.js";
import {
  insertRevision,
  replaceCurrentRelations,
} from "../../infrastructure/postgres/revision-persistence.js";

const restoreRevisionCommand = z
  .object({
    actor: principalId,
    idempotencyKey,
    materialId: entityId,
    revisionId: entityId,
    baseRevisionId: entityId,
  })
  .strict();

export function createRestoreRevision(
  dependencies: ContentAuthoringDependencies,
): ContentAuthoring["restoreRevision"] {
  return async (input) => {
    const parsed = parseCommand(restoreRevisionCommand, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const command = parsed.value;
    if (!(await canAuthor(dependencies.authorPolicy, command.actor))) {
      return failure({ code: "forbidden" });
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
            dependencies.materialDocumentOperations,
            claim.materialId,
            claim.revisionId,
          );
          if (replay === undefined || !replay.ok) {
            rollback({ code: "internal_error", correlationId: randomUUID() });
          }
          return replay.value;
        }

        const material = await transaction
          .selectFrom("materials")
          .select("current_draft_revision_id")
          .where("id", "=", command.materialId)
          .forUpdate()
          .executeTakeFirst();
        if (material === undefined) {
          rollback({ code: "material_not_found" });
        }
        if (material.current_draft_revision_id !== command.baseRevisionId) {
          rollback({
            code: "stale_revision",
            currentRevisionId: material.current_draft_revision_id,
          });
        }
        const source = await loadMaterialRevision(
          transaction,
          dependencies.materialDocumentOperations,
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
        const revisionId = randomUUID();
        await insertRevision(transaction, {
          actor: command.actor,
          materialId: command.materialId,
          revisionId,
          restoredFromRevisionId: source.value.id,
          metadata: source.value.metadata,
          schemaVersion: source.value.body.schemaVersion,
          body: source.value.body.doc,
        });
        await transaction
          .updateTable("materials")
          .set({
            current_draft_revision_id: revisionId,
            slug: source.value.metadata.slug,
            updated_at: new Date(),
          })
          .where("id", "=", command.materialId)
          .where("current_draft_revision_id", "=", command.baseRevisionId)
          .executeTakeFirstOrThrow();
        await replaceCurrentRelations(
          transaction,
          command.materialId,
          source.value.metadata,
        );
        await completeIdempotency(transaction, {
          actor: command.actor,
          operation: "restore_revision",
          key: command.idempotencyKey,
          materialId: command.materialId,
          revisionId,
        });
        const restored = await loadMaterialRevision(
          transaction,
          dependencies.materialDocumentOperations,
          command.materialId,
          revisionId,
        );
        if (restored === undefined || !restored.ok) {
          rollback({ code: "internal_error", correlationId: randomUUID() });
        }
        return restored.value;
      });
      return { ok: true, value: toMaterialRevisionDto(revision) };
    } catch (error) {
      return failure(
        error instanceof AuthoringRollback
          ? error.applicationError
          : mapPostgresError(error),
      );
    }
  };
}
