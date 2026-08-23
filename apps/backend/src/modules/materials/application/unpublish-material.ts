import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  UnpublishMaterialError,
  UnpublishMaterialOperation,
} from "./material-authoring.interface.js";
import type { MaterialAuthoringDependencies } from "./material-authoring.dependencies.js";
import { authorizePublish } from "./ports/author-policy.js";
import {
  failure,
  failureFromTransaction,
  rollback,
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
import {
  claimIdempotency,
  completeIdempotency,
} from "../infrastructure/postgres/idempotency.js";
import {
  loadPublicationEvent,
  unpublishMaterialProjection,
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
    try {
      const event = await dependencies.database.transaction().execute(async (transaction) => {
        const claim = await claimIdempotency(transaction, {
          actor: command.actor,
          operation: "unpublish_material",
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
          if (claim.publicationEventId === null) {
            rollback({ code: "internal_error", correlationId: randomUUID() });
          }
          const replay = await loadPublicationEvent(transaction, claim.publicationEventId);
          if (replay === undefined) {
            rollback({ code: "internal_error", correlationId: randomUUID() });
          }
          return replay;
        }

        const material = await lockMaterialForLifecycleChange(
          transaction,
          command.materialId,
        );
        if (material === undefined) {
          rollback({ code: "material_not_found" });
        }
        if (material.currentPublishedRevisionId === null) {
          const priorPublication = await transaction
            .selectFrom("material_publication_events")
            .select("id")
            .where("material_id", "=", command.materialId)
            .where("revision_id", "=", command.expectedPublishedRevisionId)
            .where("kind", "=", "publish")
            .executeTakeFirst();
          if (priorPublication === undefined) {
            rollback({ code: "publication_not_found" });
          }
        }
        const transition = material.unpublish(
          command.expectedPublishedRevisionId,
        );
        if (!transition.ok) {
          rollback(transition.error);
        }
        const eventId = randomUUID();
        const publication = await unpublishMaterialProjection(transaction, {
          actor: command.actor,
          eventId,
          materialId: command.materialId,
          revisionId: command.expectedPublishedRevisionId,
        });
        await completeIdempotency(transaction, {
          actor: command.actor,
          operation: "unpublish_material",
          key: command.idempotencyKey,
          materialId: command.materialId,
          revisionId: command.expectedPublishedRevisionId,
          publicationEventId: eventId,
        });
        return publication;
      });
      return {
        ok: true,
        value: {
          materialId: event.materialId,
          revisionId: event.revisionId,
          publicationEventId: event.id,
          recordedAt: event.createdAt,
        },
      };
    } catch (error) {
      return failureFromTransaction<UnpublishMaterialError>(
        error,
        mapPostgresReadError,
      );
    }
  };
}
