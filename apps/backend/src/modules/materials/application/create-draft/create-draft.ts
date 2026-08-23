import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  ContentAuthoring,
  CreateDraftCommand,
} from "../content-authoring.interface.js";
import { canAuthor } from "../ports/author-policy.js";
import type { ContentAuthoringDependencies } from "../content-authoring.dependencies.js";
import {
  AuthoringRollback,
  failure,
  rollback,
} from "../shared/application-result.js";
import { fingerprintCommand } from "../shared/canonical-command-fingerprint.js";
import { claimOrReplay } from "../shared/claim-or-replay.js";
import {
  idempotencyKey,
  parseCommand,
  principalId,
} from "../shared/command-validation.js";
import { toMaterialRevisionDto } from "../shared/material-revision-dto.js";
import { mapPostgresError } from "../shared/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "../shared/reference-integrity.js";
import { MaterialRevisionMetadata } from "../../domain/material-revision-metadata.js";
import type { AuthoringTransaction } from "../../infrastructure/postgres/database.js";
import { completeIdempotency } from "../../infrastructure/postgres/idempotency.js";
import { loadMaterialRevision } from "../../infrastructure/postgres/material-persistence.js";
import {
  insertRevision,
  replaceCurrentRelations,
} from "../../infrastructure/postgres/revision-persistence.js";

const createDraftCommand = z
  .object({
    actor: principalId,
    idempotencyKey,
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
  dependencies: ContentAuthoringDependencies,
): ContentAuthoring["createDraft"] {
  return async (input: CreateDraftCommand) => {
    const parsedCommand = parseCommand(createDraftCommand, input);
    if (!parsedCommand.ok) {
      return failure(parsedCommand.error);
    }
    const command = parsedCommand.value;
    const metadata = MaterialRevisionMetadata.create(command.metadata);
    if (!metadata.ok) {
      return failure(metadata.error);
    }
    if (!(await canAuthor(dependencies.authorPolicy, command.actor))) {
      return failure({ code: "forbidden" });
    }
    const body = dependencies.materialDocumentOperations.accept(command.body, {
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

          const materialId = randomUUID();
          const revisionId = randomUUID();
          await requireReferenceIntegrity(transaction, materialId, metadata.value);
          await insertMaterial(transaction, {
            materialId,
            revisionId,
            slug: metadata.value.slug,
          });
          await insertRevision(transaction, {
            actor: command.actor,
            materialId,
            revisionId,
            metadata: metadata.value,
            schemaVersion: body.value.schemaVersion,
            body: body.value.doc,
          });
          await replaceCurrentRelations(transaction, materialId, metadata.value);
          await completeIdempotency(transaction, {
            actor: command.actor,
            operation: "create_draft",
            key: command.idempotencyKey,
            materialId,
            revisionId,
          });
          const revision = await loadMaterialRevision(
            transaction,
            dependencies.materialDocumentOperations,
            materialId,
            revisionId,
          );
          if (revision === undefined || !revision.ok) {
            rollback({ code: "internal_error", correlationId: randomUUID() });
          }
          return revision.value;
        });
      return { ok: true, value: toMaterialRevisionDto(value) };
    } catch (error) {
      return failure(
        error instanceof AuthoringRollback
          ? error.applicationError
          : mapPostgresError(error, metadata.value),
      );
    }
  };
}
