import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { ContentAuthoring } from "../content-authoring.interface.js";
import type { ContentAuthoringDependencies } from "../content-authoring.dependencies.js";
import { canPublish } from "../ports/author-policy.js";
import { AuthoringRollback, failure, rollback } from "../shared/application-result.js";
import { fingerprintCommand } from "../shared/canonical-command-fingerprint.js";
import {
  entityId,
  idempotencyKey,
  parseCommand,
  principalId,
} from "../shared/command-validation.js";
import { mapPostgresError } from "../shared/postgres-error-mapping.js";
import {
  claimIdempotency,
  completeIdempotency,
} from "../../infrastructure/postgres/idempotency.js";
import {
  loadPublicationEvent,
  unpublishMaterialProjection,
} from "../../infrastructure/postgres/lifecycle-persistence.js";

const unpublishMaterialCommand = z
  .object({
    actor: principalId,
    idempotencyKey,
    materialId: entityId,
    expectedPublishedRevisionId: entityId,
  })
  .strict();

export function createUnpublishMaterial(
  dependencies: ContentAuthoringDependencies,
): ContentAuthoring["unpublishMaterial"] {
  return async (input) => {
    const parsed = parseCommand(unpublishMaterialCommand, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const command = parsed.value;
    if (!(await canPublish(dependencies.authorPolicy, command.actor))) {
      return failure({ code: "forbidden" });
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

        const material = await transaction
          .selectFrom("materials")
          .select("current_published_revision_id")
          .where("id", "=", command.materialId)
          .forUpdate()
          .executeTakeFirst();
        if (material === undefined) {
          rollback({ code: "material_not_found" });
        }
        if (material.current_published_revision_id === null) {
          rollback({ code: "publication_not_found" });
        }
        if (
          material.current_published_revision_id !==
          command.expectedPublishedRevisionId
        ) {
          rollback({
            code: "stale_publication",
            currentPublishedRevisionId: material.current_published_revision_id,
          });
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
      return failure(
        error instanceof AuthoringRollback
          ? error.applicationError
          : mapPostgresError(error),
      );
    }
  };
}
