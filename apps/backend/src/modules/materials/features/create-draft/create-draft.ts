import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  CreateDraftError,
  CreateDraftOperation,
} from "./create-draft.contract.js";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { MaterialBodyOperations } from "../../domain/material-body/material-body.js";
import { authorizeAuthor, type AuthorPolicy } from "../../ports/author-policy.js";
import {
  executeAuthoringTransaction,
  failure,
} from "../../shared/application-result.js";
import { fingerprintCommand } from "../../shared/canonical-command-fingerprint.js";
import { executeIdempotentRevision } from "../../shared/idempotent-operation.js";
import {
  idempotencyKeySchema,
  parseCommand,
  principalId,
} from "../../shared/command-validation.js";
import { toMaterialRevisionDto } from "../../shared/material-revision-dto.js";
import { mapPostgresError } from "../../shared/postgres-error-mapping.js";
import { requireMaterialRevision } from "../../shared/require-material-revision.js";
import { requireReferenceIntegrity } from "../../shared/reference-integrity.js";
import { MaterialRevisionMetadata } from "../../domain/material-revision-metadata.js";
import type { MaterialRevision } from "../../domain/material.js";
import {
  materialId,
  materialRevisionId,
} from "../../domain/material-identifiers.js";
import {
  insertRevision,
  replaceCurrentRelations,
} from "../../infrastructure/postgres/revision-persistence.js";

const createDraftCommand = z
  .object({
    actor: principalId,
    idempotencyKey: idempotencyKeySchema,
    metadata: z.unknown(),
    body: z.unknown(),
  })
  .strict();

interface Dependencies {
  readonly prisma: MaterialsPrismaClient;
  readonly materialBodyOperations: MaterialBodyOperations;
  readonly authorPolicy: AuthorPolicy;
}

export function assembleCreateDraft(
  dependencies: Dependencies,
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

    const result = await executeAuthoringTransaction<
      MaterialRevision,
      CreateDraftError
    >(
      dependencies.prisma,
      (transaction, rollback) =>
        executeIdempotentRevision(
          transaction,
          dependencies.materialBodyOperations,
          {
            actor: command.actor,
            operation: "create_draft",
            key: command.idempotencyKey,
            fingerprint,
          },
          rollback,
          async () => {
            const newMaterialId = materialId(randomUUID());
            const revisionId = materialRevisionId(randomUUID());
            await requireReferenceIntegrity(
              transaction,
              newMaterialId,
              metadata.value,
              rollback,
            );
            await transaction.material.create({
              data: {
                id: newMaterialId,
                slug: metadata.value.slug,
                currentDraftRevisionId: revisionId,
              },
            });
            await insertRevision(transaction, {
              actor: command.actor,
              materialId: newMaterialId,
              revisionId,
              metadata: metadata.value,
              schemaVersion: body.value.schemaVersion,
              body: body.value.doc,
            });
            await replaceCurrentRelations(
              transaction,
              newMaterialId,
              metadata.value,
            );
            return requireMaterialRevision(
              transaction,
              dependencies.materialBodyOperations,
              newMaterialId,
              revisionId,
              rollback,
            );
          },
        ),
      (unexpected) => mapPostgresError(unexpected, metadata.value),
    );
    return result.ok
      ? { ok: true, value: toMaterialRevisionDto(result.value) }
      : result;
  };
}
