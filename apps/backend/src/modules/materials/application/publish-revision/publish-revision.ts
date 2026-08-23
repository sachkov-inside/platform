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
import { requireReferenceIntegrity } from "../shared/reference-integrity.js";
import {
  claimIdempotency,
  completeIdempotency,
} from "../../infrastructure/postgres/idempotency.js";
import {
  loadPublicationEvent,
  publishRevisionProjection,
} from "../../infrastructure/postgres/lifecycle-persistence.js";
import { loadMaterialRevision } from "../../infrastructure/postgres/material-persistence.js";
import type { MaterialRevisionMetadata } from "../../domain/material-revision-metadata.js";

const publishRevisionCommand = z
  .object({
    actor: principalId,
    idempotencyKey,
    materialId: entityId,
    revisionId: entityId,
    expectedPublishedRevisionId: entityId.nullable(),
  })
  .strict();

export function createPublishRevision(
  dependencies: ContentAuthoringDependencies,
): ContentAuthoring["publishRevision"] {
  return async (input) => {
    const parsed = parseCommand(publishRevisionCommand, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const command = parsed.value;
    if (!(await canPublish(dependencies.authorPolicy, command.actor))) {
      return failure({ code: "forbidden" });
    }
    const fingerprint = fingerprintCommand({ operation: "publish_revision", ...command });
    let publicationMetadata: MaterialRevisionMetadata | undefined;
    try {
      const event = await dependencies.database.transaction().execute(async (transaction) => {
        const claim = await claimIdempotency(transaction, {
          actor: command.actor,
          operation: "publish_revision",
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
          .select(["current_draft_revision_id", "current_published_revision_id"])
          .where("id", "=", command.materialId)
          .forUpdate()
          .executeTakeFirst();
        if (material === undefined) {
          rollback({ code: "material_not_found" });
        }
        if (material.current_draft_revision_id !== command.revisionId) {
          rollback({
            code: "stale_revision",
            currentRevisionId: material.current_draft_revision_id,
          });
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

        const revision = await loadMaterialRevision(
          transaction,
          dependencies.materialDocumentOperations,
          command.materialId,
          command.revisionId,
        );
        if (revision === undefined || !revision.ok) {
          rollback({ code: "internal_error", correlationId: randomUUID() });
        }
        publicationMetadata = revision.value.metadata;
        await requireReferenceIntegrity(
          transaction,
          command.materialId,
          revision.value.metadata,
        );
        const extraction = dependencies.materialDocumentOperations.extract(revision.value.body);
        if (!extraction.ok) {
          rollback(extraction.error);
        }
        const eventId = randomUUID();
        const publication = await publishRevisionProjection(transaction, {
          actor: command.actor,
          eventId,
          extraction: extraction.value,
          revision: revision.value,
        });
        await completeIdempotency(transaction, {
          actor: command.actor,
          operation: "publish_revision",
          key: command.idempotencyKey,
          materialId: command.materialId,
          revisionId: command.revisionId,
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
          : mapPostgresError(error, publicationMetadata),
      );
    }
  };
}
