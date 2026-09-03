import { z } from "zod";

import type {
  DeleteDraftError,
  DeleteDraftOperation,
} from "./delete-draft.contract.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import {
  lockMaterialForLifecycleChange,
} from "../../infrastructure/postgres/material-locks.js";
import { lockMaterialReferenceChanges } from "../../../../infrastructure/prisma/index.js";
import { lockMaterialSeries } from "../../infrastructure/postgres/series-order.js";
import { authorizeManager } from "../../ports/author-policy.js";
import {
  executeAuthoringTransaction,
  failure,
} from "../../shared/application-result.js";
import { fingerprintCommand } from "../../shared/canonical-command-fingerprint.js";
import {
  accountId,
  idempotencyKeySchema,
  materialIdSchema,
  parseCommand,
} from "../../shared/command-validation.js";
import { executeIdempotentMaterialMutation } from "../../shared/idempotent-operation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { requestVideoDeletion } from "../../../videos/index.js";

const deleteDraftCommand = z
  .object({
    actor: accountId,
    idempotencyKey: idempotencyKeySchema,
    materialId: materialIdSchema,
    expectedContentVersion: z.number().int().positive(),
    deleteVideoId: z.uuid().nullable().optional().default(null),
  })
  .strict();

type DeleteDraftEffect = {
  readonly kind: "deleted";
  readonly materialId: string;
};

export function assembleDeleteDraft(
  dependencies: MaterialAuthoringDependencies,
): DeleteDraftOperation {
  return async (input) => {
    const parsed = parseCommand(deleteDraftCommand, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const command = parsed.value;
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }
    const fingerprint = fingerprintCommand({
      operation: "delete_draft",
      materialId: command.materialId,
      expectedContentVersion: command.expectedContentVersion,
      deleteVideoId: command.deleteVideoId,
    });
    const result = await executeAuthoringTransaction<
      DeleteDraftEffect,
      DeleteDraftError
    >(
      dependencies.prisma,
      (transaction, rollback) =>
        executeIdempotentMaterialMutation<DeleteDraftEffect>(
          transaction,
          {
            actor: command.actor,
            operation: "delete_draft",
            key: command.idempotencyKey,
            fingerprint,
            effectKind: "deleted",
          },
          rollback,
          async () => {
            await lockMaterialSeries(transaction, command.materialId);
            await lockMaterialReferenceChanges(transaction, [command.materialId]);
            const material = await lockMaterialForLifecycleChange(
              transaction,
              command.materialId,
            );
            if (material === undefined) {
              return rollback({ code: "material_not_found" });
            }
            if (
              material.lifecycle.contentVersion !==
              command.expectedContentVersion
            ) {
              return rollback({
                code: "stale_content_version",
                currentContentVersion: material.lifecycle.contentVersion,
              });
            }
            if (!material.lifecycle.canDelete()) {
              return rollback({ code: "draft_deletion_forbidden" });
            }
            if (
              command.deleteVideoId !== null &&
              material.primaryVideoId !== command.deleteVideoId
            ) {
              return rollback({
                code: "invalid_reference",
                issues: [{ code: "video_deletion_target_mismatch", path: "/deleteVideoId" }],
              });
            }
            if (command.deleteVideoId !== null) {
              const deletion = await requestVideoDeletion(transaction, {
                actor: command.actor,
                materialId: command.materialId,
                videoId: command.deleteVideoId,
              }, new Date());
              if (!deletion.ok) {
                return rollback({
                  code: "invalid_reference",
                  issues: [{ code: deletion.code, path: "/deleteVideoId" }],
                });
              }
            }
            await transaction.material.delete({
              where: { id: command.materialId },
            });
            return { kind: "deleted", materialId: command.materialId };
          },
        ),
      mapPostgresReadError,
    );
    return result.ok
      ? { ok: true, value: { materialId: result.value.materialId } }
      : result;
  };
}
