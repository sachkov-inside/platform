import {
  checkContentWrite,
  contentWriter,
} from "../../domain/content-write-policy.js";
import { z } from "zod";
import { type LegacyPracticeSelection } from "../../domain/practice-definition.js";

import type {
  DeleteDraftError,
  DeleteDraftOperation,
} from "./delete-draft.contract.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { lockMaterialForLifecycleChange } from "../../infrastructure/postgres/material-locks.js";
import {
  lockMaterialReferenceChanges,
  lockPracticeImport,
} from "../../../../infrastructure/prisma/index.js";
import { loadChangedProductMemberships } from "../../infrastructure/postgres/source-product-memberships.js";
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
  sourceId: string | null = null,
  expectedLegacyPractices: readonly LegacyPracticeSelection[] = [],
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
      ...(sourceId === null
        ? {}
        : {
            sourceId,
            expectedLegacyPractices: [...expectedLegacyPractices].sort((a, b) =>
              a.practiceId.localeCompare(b.practiceId),
            ),
          }),
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
            const memberships = await loadChangedProductMemberships(
              transaction,
              command.materialId,
              [],
            );
            // Practice imports take their identity lock before the Material row, including rebinds.
            // Match that order so a confirmed legacy definition cannot move while being removed.
            if (sourceId !== null)
              for (const practice of [...expectedLegacyPractices].sort((a, b) =>
                a.practiceId.localeCompare(b.practiceId),
              )) {
                await lockPracticeImport(transaction, practice.practiceId);
              }
            await lockMaterialReferenceChanges(transaction, [
              command.materialId,
            ]);
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
            const sourceError = checkContentWrite(contentWriter(sourceId), [
              {
                kind: "material",
                sourceId: material.sourceId,
                path: "/materialId",
              },
              ...memberships,
            ]);
            if (sourceError !== null) return rollback(sourceError);
            if (!material.lifecycle.canDelete()) {
              return rollback({ code: "draft_deletion_forbidden" });
            }
            // Product composition need not increment Material.contentVersion. Read membership
            // again while holding the shared reference lock, including a concurrent new placement.
            if (
              sourceId !== null &&
              (await transaction.productMembership.count({
                where: { materialId: command.materialId },
              })) > 0
            ) {
              return rollback({
                code: "invalid_reference",
                issues: [
                  {
                    code: "source_draft_still_in_product",
                    path: "/materialId",
                  },
                ],
              });
            }
            if (
              sourceId !== null &&
              (command.deleteVideoId !== null ||
                material.primaryVideoId !== null)
            ) {
              return rollback({
                code: "invalid_reference",
                issues: [
                  {
                    code: "import_video_deletion_forbidden",
                    path: "/deleteVideoId",
                  },
                ],
              });
            }
            if (
              command.deleteVideoId !== null &&
              material.primaryVideoId !== command.deleteVideoId
            ) {
              return rollback({
                code: "invalid_reference",
                issues: [
                  {
                    code: "video_deletion_target_mismatch",
                    path: "/deleteVideoId",
                  },
                ],
              });
            }
            if (command.deleteVideoId !== null) {
              const deletion = await requestVideoDeletion(
                transaction,
                {
                  actor: command.actor,
                  materialId: command.materialId,
                  videoId: command.deleteVideoId,
                },
                new Date(),
              );
              if (!deletion.ok) {
                return rollback({
                  code: "invalid_reference",
                  issues: [{ code: deletion.code, path: "/deleteVideoId" }],
                });
              }
            }
            if (sourceId !== null) {
              const practices = await transaction.practiceDefinition.findMany({
                where: { materialId: command.materialId },
                orderBy: { practiceId: "asc" },
              });
              const selected = new Map(
                expectedLegacyPractices.map((row) => [row.practiceId, row]),
              );
              if (
                practices.length !== selected.size ||
                practices.some((row) => {
                  const choice = selected.get(row.practiceId);
                  return (
                    choice === undefined ||
                    choice.practiceVersion !== Number(row.practiceVersion) ||
                    choice.definitionDigest !== row.definitionDigest ||
                    row.boundSourceId !== sourceId ||
                    row.publicationState !== "unpublished"
                  );
                })
              )
                return rollback({
                  code: "invalid_reference",
                  issues: [
                    {
                      code: "source_draft_dependencies_changed",
                      path: "/expectedLegacyPractices",
                    },
                  ],
                });
              // The Material row lock also serializes practice imports. Receipts and Product Task
              // history remain intact; only the explicitly selected private current definitions go.
              if (practices.length > 0)
                await transaction.practiceDefinition.deleteMany({
                  where: { materialId: command.materialId },
                });
            }
            await transaction.material.delete({
              where: { id: command.materialId },
            });
            return { kind: "deleted", materialId: command.materialId };
          },
        ),
      mapPostgresReadError,
      "deleteDraft",
    );
    return result.ok
      ? { ok: true, value: { materialId: result.value.materialId } }
      : result;
  };
}
