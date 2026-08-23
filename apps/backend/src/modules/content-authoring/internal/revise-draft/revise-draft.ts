import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  ContentAuthoring,
  ReviseDraftCommand,
} from "../../content-authoring.interface.js";
import { canAuthor } from "../author-policy.js";
import type { ContentAuthoringDependencies } from "../content-authoring.dependencies.js";
import {
  AuthoringRollback,
  failure,
  rollback,
} from "../shared/application-result.js";
import { fingerprintCommand } from "../shared/canonical-command-fingerprint.js";
import {
  entityId,
  idempotencyKey,
  parseCommand,
  principalId,
} from "../shared/command-validation.js";
import type { AuthoringTransaction } from "../shared/database.js";
import {
  hydratePersistedDraft,
  loadCurrentRevisionId,
  loadPersistedDraft,
  loadWriteValue,
} from "../shared/draft-snapshot.js";
import {
  claimOrReplay,
  completeIdempotency,
} from "../shared/idempotency.js";
import {
  materialMetadataFields,
  validateMetadata,
} from "../shared/material-rules.js";
import { mapPostgresError } from "../shared/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "../shared/reference-integrity.js";
import {
  insertRevision,
  replaceCurrentRelations,
} from "../shared/revision-persistence.js";

const metadataChanges = z
  .object({
    title: materialMetadataFields.title.optional(),
    summary: materialMetadataFields.summary.optional(),
    slug: materialMetadataFields.slug.optional(),
    topicId: materialMetadataFields.topicId.optional(),
    formatId: materialMetadataFields.formatId.optional(),
    tagIds: materialMetadataFields.tagIds.optional(),
    seriesMemberships: materialMetadataFields.seriesMemberships.optional(),
  })
  .strict();

const documentChange = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("replace_document"), document: z.unknown() }).strict(),
  z
    .object({
      kind: z.literal("insert_blocks"),
      afterNodeId: entityId.nullable(),
      blocks: z.array(z.unknown()).max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("replace_block"),
      nodeId: entityId,
      block: z.unknown(),
    })
    .strict(),
  z.object({ kind: z.literal("delete_block"), nodeId: entityId }).strict(),
  z
    .object({
      kind: z.literal("replace_text"),
      nodeId: entityId,
      from: z.number().int().nonnegative().max(500_000),
      to: z.number().int().nonnegative().max(500_000),
      text: z.string().max(500_000),
    })
    .strict(),
]);

const reviseDraftCommand = z
  .object({
    actor: principalId,
    idempotencyKey,
    materialId: entityId,
    baseRevisionId: entityId,
    changes: z
      .object({
        metadata: metadataChanges.optional(),
        body: z.array(documentChange).max(100).optional(),
      })
      .strict(),
  })
  .strict();

async function advanceCurrentRevision(
  transaction: AuthoringTransaction,
  values: {
    readonly materialId: string;
    readonly baseRevisionId: string;
    readonly revisionId: string;
    readonly slug: string;
  },
): Promise<boolean> {
  const updated = await transaction
    .updateTable("materials")
    .set({
      current_draft_revision_id: values.revisionId,
      slug: values.slug,
      updated_at: new Date(),
    })
    .where("id", "=", values.materialId)
    .where("current_draft_revision_id", "=", values.baseRevisionId)
    .returning("id")
    .executeTakeFirst();
  return updated !== undefined;
}

export function createReviseDraft(
  dependencies: ContentAuthoringDependencies,
): ContentAuthoring["reviseDraft"] {
  return async (input: ReviseDraftCommand) => {
    const parsedCommand = parseCommand(reviseDraftCommand, input);
    if (!parsedCommand.ok) {
      return failure(parsedCommand.error);
    }
    const command = parsedCommand.value;
    if (!(await canAuthor(dependencies.authorPolicy, command.actor))) {
      return failure({ code: "forbidden" });
    }

    let persistedBase;
    try {
      persistedBase = await loadPersistedDraft(
        dependencies.database,
        command.materialId,
        command.baseRevisionId,
      );
      if (persistedBase === undefined) {
        const currentRevisionId = await loadCurrentRevisionId(
          dependencies.database,
          command.materialId,
        );
        return currentRevisionId === undefined
          ? failure({ code: "material_not_found" })
          : failure({ code: "stale_revision", currentRevisionId });
      }
    } catch (error) {
      return failure(mapPostgresError(error));
    }

    const base = hydratePersistedDraft(dependencies.contentSchema, persistedBase);
    if (!base.ok) {
      return failure(base.error);
    }
    const metadata = validateMetadata({
      ...base.value.metadata,
      ...command.changes.metadata,
    });
    if (!metadata.ok) {
      return failure(metadata.error);
    }
    const body =
      command.changes.body === undefined
        ? { ok: true as const, value: base.value.body }
        : dependencies.contentSchema.applyChanges(
            base.value.body,
            command.changes.body,
          );
    if (!body.ok) {
      return failure(body.error);
    }
    const fingerprint = fingerprintCommand({
      operation: "revise_draft",
      actor: command.actor,
      materialId: command.materialId,
      baseRevisionId: command.baseRevisionId,
      contentSchemaVersion: base.value.body.schemaVersion,
      changes: command.changes,
    });

    try {
      const value = await dependencies.database
        .transaction()
        .execute(async (transaction) => {
          const replay = await claimOrReplay(transaction, dependencies.contentSchema, {
            actor: command.actor,
            operation: "revise_draft",
            key: command.idempotencyKey,
            fingerprint,
          });
          if (replay !== undefined) {
            return replay;
          }

          await requireReferenceIntegrity(
            transaction,
            command.materialId,
            metadata.value,
          );
          const revisionId = randomUUID();
          await insertRevision(transaction, {
            actor: command.actor,
            materialId: command.materialId,
            revisionId,
            metadata: metadata.value,
            schemaVersion: body.value.schemaVersion,
            body: body.value.doc,
          });
          const advanced = await advanceCurrentRevision(transaction, {
            materialId: command.materialId,
            baseRevisionId: command.baseRevisionId,
            revisionId,
            slug: metadata.value.slug,
          });
          if (!advanced) {
            const currentRevisionId = await loadCurrentRevisionId(
              transaction,
              command.materialId,
            );
            if (currentRevisionId === undefined) {
              rollback({ code: "material_not_found" });
            }
            rollback({ code: "stale_revision", currentRevisionId });
          }
          await replaceCurrentRelations(
            transaction,
            command.materialId,
            metadata.value,
          );
          await completeIdempotency(transaction, {
            actor: command.actor,
            operation: "revise_draft",
            key: command.idempotencyKey,
            materialId: command.materialId,
            revisionId,
          });
          return loadWriteValue(
            transaction,
            dependencies.contentSchema,
            command.materialId,
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
