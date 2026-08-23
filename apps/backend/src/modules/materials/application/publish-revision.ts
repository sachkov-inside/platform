import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  PublishRevisionError,
  PublishRevisionOperation,
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
import { mapPostgresLifecycleError } from "./shared/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "./shared/reference-integrity.js";
import { executeIdempotentPublication } from "./shared/idempotent-operation.js";
import {
  publishRevisionProjection,
  type PublicationEvent,
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
      {
        action: "publish",
        principalId: command.actor,
        materialId: command.materialId,
        revisionId: command.revisionId,
      },
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }
    const fingerprint = fingerprintCommand({ operation: "publish_revision", ...command });
    let publicationMetadata: MaterialRevisionMetadata | undefined;
    const result = await executeAuthoringTransaction<
      PublicationEvent,
      PublishRevisionError
    >(
      dependencies.database,
      (transaction, rollback) =>
        executeIdempotentPublication(
          transaction,
          {
            actor: command.actor,
            operation: "publish_revision",
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
            const revision = await loadMaterialRevision(
              transaction,
              dependencies.materialBodyOperations,
              command.materialId,
              command.revisionId,
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
            const transition = material.publishRevision(
              command.revisionId,
              command.expectedPublishedRevisionId,
            );
            if (!transition.ok) {
              return rollback(transition.error);
            }
            publicationMetadata = revision.value.metadata;
            await requireReferenceIntegrity(
              transaction,
              command.materialId,
              revision.value.metadata,
              rollback,
            );
            const extraction = dependencies.materialBodyOperations.extract(
              revision.value.body,
            );
            if (!extraction.ok) {
              return rollback(extraction.error);
            }
            return publishRevisionProjection(transaction, {
              actor: command.actor,
              eventId: randomUUID(),
              extraction: extraction.value,
              revision: revision.value,
            });
          },
        ),
      (unexpected) =>
        mapPostgresLifecycleError(unexpected, publicationMetadata),
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
