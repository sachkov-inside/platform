import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  UnpublishMaterialError,
  UnpublishMaterialOperation,
} from "./material-authoring.interface.js";
import type { MaterialAuthoringDependencies } from "./material-authoring.dependencies.js";
import { authorizePublish } from "./ports/author-policy.js";
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
import { mapPostgresReadError } from "./shared/postgres-error-mapping.js";
import { executeIdempotentPublication } from "./shared/idempotent-operation.js";
import {
  unpublishMaterialProjection,
  type PublicationEvent,
} from "../infrastructure/postgres/lifecycle-persistence.js";
import { lockMaterialForLifecycleChange } from "../infrastructure/postgres/material-persistence.js";

const unpublishMaterialCommand = z
  .object({
    actor: principalId,
    idempotencyKey: idempotencyKeySchema,
    materialId: materialIdSchema,
    expectedPublishedRevisionId: materialRevisionIdSchema,
  })
  .strict();

export function createUnpublishMaterial(
  dependencies: MaterialAuthoringDependencies,
): UnpublishMaterialOperation {
  return async (input) => {
    const parsed = parseCommand(unpublishMaterialCommand, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const command = parsed.value;
    const authorization = await authorizePublish(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }
    const fingerprint = fingerprintCommand({ operation: "unpublish_material", ...command });
    const result = await executeAuthoringTransaction<
      PublicationEvent,
      UnpublishMaterialError
    >(
      dependencies.database,
      (transaction, rollback) =>
        executeIdempotentPublication(
          transaction,
          {
            actor: command.actor,
            operation: "unpublish_material",
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
            if (material.currentPublishedRevisionId === null) {
              const priorPublication = await transaction
                .selectFrom("material_publication_events")
                .select("id")
                .where("material_id", "=", command.materialId)
                .where(
                  "revision_id",
                  "=",
                  command.expectedPublishedRevisionId,
                )
                .where("kind", "=", "publish")
                .executeTakeFirst();
              if (priorPublication === undefined) {
                return rollback({ code: "publication_not_found" });
              }
            }
            const transition = material.unpublish(
              command.expectedPublishedRevisionId,
            );
            if (!transition.ok) {
              return rollback(transition.error);
            }
            return unpublishMaterialProjection(transaction, {
              actor: command.actor,
              eventId: randomUUID(),
              materialId: command.materialId,
              revisionId: command.expectedPublishedRevisionId,
            });
          },
        ),
      mapPostgresReadError,
    );
    return result.ok
      ? {
        ok: true,
        value: {
          materialId: result.value.materialId,
          revisionId: result.value.revisionId,
          publicationEventId: result.value.id,
          recordedAt: result.value.createdAt,
        },
      }
      : result;
  };
}
