import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  CreateDraftError,
  CreateDraftOperation,
} from "./create-draft.contract.js";
import { materialId } from "../../domain/material-identifiers.js";
import { MaterialMetadata } from "../../domain/material-metadata.js";
import { authorizeManager } from "../../ports/author-policy.js";
import {
  executeAuthoringTransaction,
  failure,
} from "../../shared/application-result.js";
import { fingerprintCommand } from "../../shared/canonical-command-fingerprint.js";
import {
  accountId,
  idempotencyKeySchema,
  parseCommand,
} from "../../shared/command-validation.js";
import { executeIdempotentMaterialMutation } from "../../shared/idempotent-operation.js";
import { mapPostgresError } from "../../shared/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "../../shared/reference-integrity.js";
import { toDatabaseJson } from "../../infrastructure/postgres/database-json.js";
import { replaceCurrentRelations } from "../../infrastructure/postgres/current-material.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";

const createDraftCommand = z
  .object({
    actor: accountId,
    idempotencyKey: idempotencyKeySchema,
    metadata: z.unknown(),
    body: z.unknown(),
  })
  .strict();

export function assembleCreateDraft(
  dependencies: MaterialAuthoringDependencies,
): CreateDraftOperation {
  return async (input) => {
    const parsedCommand = parseCommand(createDraftCommand, input);
    if (!parsedCommand.ok) {
      return failure(parsedCommand.error);
    }
    const command = parsedCommand.value;
    const metadata = MaterialMetadata.create(command.metadata);
    if (!metadata.ok) {
      return failure(metadata.error);
    }
    const body = dependencies.materialBodyOperations.accept(command.body, {
      assignMissingNodeIds: true,
    });
    if (!body.ok) {
      return failure(body.error);
    }
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }

    const fingerprint = fingerprintCommand({
      operation: "create_draft",
      metadata: metadata.value.toValues(),
      body: body.value,
    });
    const result = await executeAuthoringTransaction<CreateDraftEffect, CreateDraftError>(
      dependencies.prisma,
      (transaction, rollback) =>
        executeIdempotentMaterialMutation<CreateDraftEffect>(
          transaction,
          {
            actor: command.actor,
            operation: "create_draft",
            key: command.idempotencyKey,
            fingerprint,
            effectKind: "material",
          },
          rollback,
          async () => {
            const newMaterialId = materialId(randomUUID());
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
                title: metadata.value.title,
                summary: metadata.value.summary,
                topicId: metadata.value.topicId,
                formatId: metadata.value.formatId,
                schemaVersion: body.value.schemaVersion,
                body: toDatabaseJson(body.value.doc),
                createdBy: command.actor,
                access: metadata.value.access,
                publicationState: "draft",
                contentVersion: 1n,
              },
            });
            await replaceCurrentRelations(
              transaction,
              newMaterialId,
              metadata.value,
            );
            return {
              kind: "material",
              receipt: {
                materialId: newMaterialId,
                contentVersion: 1,
                publicationState: "draft",
                publishedAt: null,
              },
            };
          },
        ),
      (unexpected) => mapPostgresError(unexpected, metadata.value),
    );
    return result.ok ? { ok: true, value: result.value.receipt } : result;
  };
}

type CreateDraftEffect = {
  readonly kind: "material";
  readonly receipt: {
    readonly materialId: string;
    readonly contentVersion: number;
    readonly publicationState: "draft";
    readonly publishedAt: null;
  };
};
