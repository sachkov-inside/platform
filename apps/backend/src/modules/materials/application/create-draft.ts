import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  CreateDraftError,
  CreateDraftOperation,
} from "./material-authoring.interface.js";
import { authorizeAuthor } from "./ports/author-policy.js";
import type { MaterialAuthoringDependencies } from "./material-authoring.dependencies.js";
import {
  failure,
  failureFromTransaction,
  rollback,
} from "./shared/application-result.js";
import { fingerprintCommand } from "./shared/canonical-command-fingerprint.js";
import { claimOrReplay } from "./shared/claim-or-replay.js";
import {
  idempotencyKeySchema,
  parseCommand,
  principalId,
} from "./shared/command-validation.js";
import { toMaterialRevisionDto } from "./shared/material-revision-dto.js";
import { mapPostgresError } from "./shared/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "./shared/reference-integrity.js";
import { MaterialRevisionMetadata } from "../domain/material-revision-metadata.js";
import {
  materialId,
  materialRevisionId,
} from "../domain/material-identifiers.js";
import type { AuthoringTransaction } from "../infrastructure/postgres/database.js";
import { completeIdempotency } from "../infrastructure/postgres/idempotency.js";
import { loadMaterialRevision } from "../infrastructure/postgres/material-persistence.js";
import {
  insertRevision,
  replaceCurrentRelations,
} from "../infrastructure/postgres/revision-persistence.js";

const createDraftCommand = z
  .object({
    actor: principalId,
    idempotencyKey: idempotencyKeySchema,
    metadata: z.unknown(),
    body: z.unknown(),
  })
  .strict();

async function insertMaterial(
  transaction: AuthoringTransaction,
  values: {
    readonly materialId: string;
    readonly revisionId: string;
    readonly slug: string;
  },
): Promise<void> {
  await transaction
    .insertInto("materials")
    .values({
      id: values.materialId,
      slug: values.slug,
      current_draft_revision_id: values.revisionId,
    })
    .executeTakeFirstOrThrow();
}

export function createCreateDraft(
  dependencies: MaterialAuthoringDependencies,
): CreateDraftOperation {
  return async (input) => {
    const parsedCommand = parseCommand(createDraftCommand, input);
    if (!parsedCommand.ok) {
      return failure(parsedCommand.error);
    }
    const command = parsedCommand.value;
    const metadata = MaterialRevisionMetadata.create(command.metadata);
    if (!metadata.ok) {
      return failure(metadata.error);
    }
    const authorization = await authorizeAuthor(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }
    const body = dependencies.materialBodyOperations.accept(command.body, {
      assignMissingNodeIds: true,
    });
    if (!body.ok) {
      return failure(body.error);
    }

    const fingerprint = fingerprintCommand({
      operation: "create_draft",
      actor: command.actor,
      metadata: metadata.value.toValues(),
      body: command.body,
    });

    try {
      const value = await dependencies.database
        .transaction()
        .execute(async (transaction) => {
          const replay = await claimOrReplay(transaction, dependencies, {
            actor: command.actor,
            operation: "create_draft",
            key: command.idempotencyKey,
            fingerprint,
          });
          if (replay !== undefined) {
            return replay;
          }

          const newMaterialId = materialId(randomUUID());
          const revisionId = materialRevisionId(randomUUID());
          await requireReferenceIntegrity(transaction, newMaterialId, metadata.value);
          await insertMaterial(transaction, {
            materialId: newMaterialId,
            revisionId,
            slug: metadata.value.slug,
          });
          await insertRevision(transaction, {
            actor: command.actor,
            materialId: newMaterialId,
            revisionId,
            metadata: metadata.value,
            schemaVersion: body.value.schemaVersion,
            body: body.value.doc,
          });
          await replaceCurrentRelations(transaction, newMaterialId, metadata.value);
          await completeIdempotency(transaction, {
            actor: command.actor,
            operation: "create_draft",
            key: command.idempotencyKey,
            materialId: newMaterialId,
            revisionId,
          });
          const revision = await loadMaterialRevision(
            transaction,
            dependencies.materialBodyOperations,
            newMaterialId,
            revisionId,
          );
          if (revision === undefined || !revision.ok) {
            rollback({ code: "internal_error", correlationId: randomUUID() });
          }
          return revision.value;
        });
      return { ok: true, value: toMaterialRevisionDto(value) };
    } catch (error) {
      return failureFromTransaction<CreateDraftError>(
        error,
        (unexpected) => mapPostgresError(unexpected, metadata.value),
      );
    }
  };
}
