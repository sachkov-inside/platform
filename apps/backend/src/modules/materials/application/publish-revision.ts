import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  PublishRevisionError,
  PublishRevisionOperation,
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
import { mapPostgresError } from "./shared/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "./shared/reference-integrity.js";
import {
  claimIdempotency,
  completeIdempotency,
} from "../infrastructure/postgres/idempotency.js";
import {
  loadPublicationEvent,
  publishRevisionProjection,
} from "../infrastructure/postgres/lifecycle-persistence.js";
import {
  lockMaterialForLifecycleChange,
  loadMaterialRevision,
} from "../infrastructure/postgres/material-persistence.js";
import type { MaterialRevisionMetadata } from "../domain/material-revision-metadata.js";

const publishRevisionCommand = z
  .object({
    actor: principalId,
    idempotencyKey: idempotencyKeySchema,
    materialId: materialIdSchema,
    revisionId: materialRevisionIdSchema,
    expectedPublishedRevisionId: materialRevisionIdSchema.nullable(),
  })
  .strict();

export function createPublishRevision(
  dependencies: MaterialAuthoringDependencies,
): PublishRevisionOperation {
  return async (input) => {
    const parsed = parseCommand(publishRevisionCommand, input);
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

        const material = await lockMaterialForLifecycleChange(
          transaction,
          command.materialId,
        );
        if (material === undefined) {
          rollback({ code: "material_not_found" });
        }
        const transition = material.publishRevision(
          command.revisionId,
          command.expectedPublishedRevisionId,
        );
        if (!transition.ok) {
          rollback(transition.error);
        }

        const revision = await loadMaterialRevision(
          transaction,
          dependencies.materialBodyOperations,
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
        const extraction = dependencies.materialBodyOperations.extract(revision.value.body);
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
      return failureFromTransaction<PublishRevisionError>(
        error,
        (unexpected) => mapPostgresError(unexpected, publicationMetadata),
      );
    }
  };
}
