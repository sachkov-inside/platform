import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  MaterialAuthoring,
  ReviseDraftCommand,
  ReviseDraftError,
} from "../material-authoring.interface.js";
import { authorizeAuthor } from "../ports/author-policy.js";
import type { MaterialAuthoringDependencies } from "../material-authoring.dependencies.js";
import {
  failure,
  failureFromTransaction,
  rollback,
} from "../shared/application-result.js";
import { claimOrReplay } from "../shared/claim-or-replay.js";
import { fingerprintCommand } from "../shared/canonical-command-fingerprint.js";
import {
  entityId,
  idempotencyKeySchema,
  materialIdSchema,
  materialRevisionIdSchema,
  parseCommand,
  principalId,
} from "../shared/command-validation.js";
import { toMaterialRevisionDto } from "../shared/material-revision-dto.js";
import { mapPostgresError } from "../shared/postgres-error-mapping.js";
import { requireReferenceIntegrity } from "../shared/reference-integrity.js";
import { MaterialRevisionMetadata } from "../../domain/material-revision-metadata.js";
import {
  materialRevisionId,
  type MaterialId,
  type MaterialRevisionId,
} from "../../domain/material-identifiers.js";
import type { AuthoringTransaction } from "../../infrastructure/postgres/database.js";
import {
  lockMaterialForLifecycleChange,
  loadCurrentRevisionId,
  loadMaterialRevision,
} from "../../infrastructure/postgres/material-persistence.js";
import { completeIdempotency } from "../../infrastructure/postgres/idempotency.js";
import {
  insertRevision,
  replaceCurrentRelations,
} from "../../infrastructure/postgres/revision-persistence.js";

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
    idempotencyKey: idempotencyKeySchema,
    materialId: materialIdSchema,
    baseRevisionId: materialRevisionIdSchema,
    changes: z
      .object({
        metadata: z.unknown().optional(),
        body: z.array(documentChange).max(100).optional(),
      })
      .strict(),
  })
  .strict();

async function advanceCurrentRevision(
  transaction: AuthoringTransaction,
  values: {
    readonly materialId: MaterialId;
    readonly baseRevisionId: MaterialRevisionId;
    readonly revisionId: MaterialRevisionId;
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
  dependencies: MaterialAuthoringDependencies,
): MaterialAuthoring["reviseDraft"] {
  return async (input: ReviseDraftCommand) => {
    const parsedCommand = parseCommand(reviseDraftCommand, input);
    if (!parsedCommand.ok) {
      return failure(parsedCommand.error);
    }
    const command = parsedCommand.value;
    const metadataChanges = MaterialRevisionMetadata.validateChanges(
      command.changes.metadata ?? {},
    );
    if (!metadataChanges.ok) {
      return failure(metadataChanges.error);
    }
    const authorization = await authorizeAuthor(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }

    let persistedBase;
    try {
      persistedBase = await loadMaterialRevision(
        dependencies.database,
        dependencies.materialBodyOperations,
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

    if (!persistedBase.ok) {
      return failure({ code: "internal_error", correlationId: randomUUID() });
    }
    const base = persistedBase.value;
    const metadata = base.metadata.revise(metadataChanges.value);
    if (!metadata.ok) {
      return failure(metadata.error);
    }
    const body =
      command.changes.body === undefined
        ? { ok: true as const, value: base.body }
        : dependencies.materialBodyOperations.applyChanges(
            base.body,
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
      contentSchemaVersion: base.body.schemaVersion,
      changes: command.changes,
    });

    try {
      const value = await dependencies.database
        .transaction()
        .execute(async (transaction) => {
          const replay = await claimOrReplay(transaction, dependencies, {
            actor: command.actor,
            operation: "revise_draft",
            key: command.idempotencyKey,
            fingerprint,
          });
          if (replay !== undefined) {
            return replay;
          }

          const material = await lockMaterialForLifecycleChange(
            transaction,
            command.materialId,
          );
          if (material === undefined) {
            rollback({ code: "material_not_found" });
          }
          const revisionId = materialRevisionId(randomUUID());
          const transition = material.advanceDraft(
            command.baseRevisionId,
            revisionId,
          );
          if (!transition.ok) {
            rollback(transition.error);
          }
          await requireReferenceIntegrity(
            transaction,
            command.materialId,
            metadata.value,
          );
          await insertRevision(transaction, {
            actor: command.actor,
            materialId: command.materialId,
            revisionId: transition.value.currentDraftRevisionId,
            metadata: metadata.value,
            schemaVersion: body.value.schemaVersion,
            body: body.value.doc,
          });
          const advanced = await advanceCurrentRevision(transaction, {
            materialId: command.materialId,
            baseRevisionId: command.baseRevisionId,
            revisionId: transition.value.currentDraftRevisionId,
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
            revisionId: transition.value.currentDraftRevisionId,
          });
          const revision = await loadMaterialRevision(
            transaction,
            dependencies.materialBodyOperations,
            command.materialId,
            transition.value.currentDraftRevisionId,
          );
          if (revision === undefined || !revision.ok) {
            rollback({ code: "internal_error", correlationId: randomUUID() });
          }
          return revision.value;
        });
      return { ok: true, value: toMaterialRevisionDto(value) };
    } catch (error) {
      return failureFromTransaction<ReviseDraftError>(
        error,
        (unexpected) => mapPostgresError(unexpected, metadata.value),
      );
    }
  };
}
