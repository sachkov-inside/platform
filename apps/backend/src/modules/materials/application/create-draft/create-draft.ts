import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  ContentAuthoring,
  CreateDraftCommand,
} from "../content-authoring.interface.js";
import { canAuthor } from "../ports/author-policy.js";
import type { ContentAuthoringDependencies } from "../content-authoring.dependencies.js";
import { AuthoringRollback, failure } from "../shared/application-result.js";
import { fingerprintCommand } from "../shared/canonical-command-fingerprint.js";
import {
  idempotencyKey,
  parseCommand,
  principalId,
} from "../shared/command-validation.js";
import {
  materialMetadataFields,
  validateMetadata,
} from "../../domain/material-rules.js";
import type { AuthoringTransaction } from "../../infrastructure/postgres/database.js";
import { loadWriteValue } from "../../infrastructure/postgres/draft-snapshot.js";
import {
  claimOrReplay,
  completeIdempotency,
} from "../../infrastructure/postgres/idempotency.js";
import { mapPostgresError } from "../../infrastructure/postgres/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "../../infrastructure/postgres/reference-integrity.js";
import {
  insertRevision,
  replaceCurrentRelations,
} from "../../infrastructure/postgres/revision-persistence.js";

const createDraftCommand = z
  .object({
    actor: principalId,
    idempotencyKey,
    metadata: z.object(materialMetadataFields).strict(),
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
    if (!(await canAuthor(dependencies.authorPolicy, command.actor))) {
      return failure({ code: "forbidden" });
    }
    const metadata = validateMetadata(command.metadata);
    if (!metadata.ok) {
      return failure(metadata.error);
    }
    const body = dependencies.materialDocument.accept(command.body, {
      assignMissingNodeIds: true,
    });
    if (!body.ok) {
      return failure(body.error);
    }

    const fingerprint = fingerprintCommand({
      operation: "create_draft",
      actor: command.actor,
      metadata: metadata.value,
      body: command.body,
    });

    try {
      const value = await dependencies.database
        .transaction()
        .execute(async (transaction) => {
          const replay = await claimOrReplay(transaction, dependencies.materialDocument, {
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
          return loadWriteValue(
            transaction,
            dependencies.materialDocument,
            materialId,
            revisionId,
          );
        });
      return { ok: true, value };
    } catch (error) {
      return failure(
        error instanceof AuthoringRollback
          ? error.applicationError
          : mapPostgresError(error, metadata.value),
      );
    }
  };
}
