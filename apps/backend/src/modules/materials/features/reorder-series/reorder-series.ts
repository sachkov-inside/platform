import { z } from "zod";

import type { MaterialsPrismaTransaction } from "../../../../infrastructure/prisma/index.js";

import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import type { ValidationIssue } from "../../domain/material-body/material-body.js";
import {
  loadSeriesOrderSnapshot,
  lockSeries,
  replaceGuideComposition,
} from "../../infrastructure/postgres/series-order.js";
import { authorizeManager } from "../../ports/author-policy.js";
import {
  executeAuthoringTransaction,
  failure,
} from "../../shared/application-result.js";
import { accountId, entityId, parseCommand } from "../../shared/command-validation.js";
import {
  guideChapterAssignmentsSchema,
  guideChapterDraftsSchema,
  type GuideChapterDraft,
} from "../../shared/guide-chapters.js";
import {
  guideOrderVersion,
  type GuideChapterEntry,
} from "../../shared/guide-order-version.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { seriesStepGroupsSchema } from "../../shared/series-step-groups.js";
import { guideChapterPlacementIssues } from "./guide-chapter-placement.js";
import type {
  ReorderSeriesError,
  ReorderSeriesOperation,
  ReorderSeriesReceiptDto,
} from "./reorder-series.contract.js";

const commandSchema = z
  .object({
    actor: accountId,
    chapters: guideChapterDraftsSchema.optional(),
    chapterAssignments: guideChapterAssignmentsSchema.optional(),
    expectedOrderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
    orderedMaterialIds: z.array(entityId),
    stepGroups: seriesStepGroupsSchema.optional(),
    seriesId: entityId,
  })
  .strict()
  .refine(
    ({ orderedMaterialIds }) =>
      new Set(orderedMaterialIds).size === orderedMaterialIds.length,
    { path: ["orderedMaterialIds"], message: "Material IDs must be unique" },
  )
  .refine(
    ({ orderedMaterialIds, stepGroups }) => Object.keys(stepGroups ?? {}).every((id) => orderedMaterialIds.includes(id)),
    { path: ["stepGroups"], message: "Step groups must reference composition members" },
  )
  .refine(
    ({ chapterAssignments, orderedMaterialIds }) => Object.keys(chapterAssignments ?? {}).every((id) => orderedMaterialIds.includes(id)),
    { path: ["chapterAssignments"], message: "Chapter placement must reference composition members" },
  );

export function assembleReorderSeries(
  dependencies: MaterialAuthoringDependencies,
): ReorderSeriesOperation {
  return async (input) => {
    const parsed = parseCommand(commandSchema, input);
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

    return executeAuthoringTransaction<
      ReorderSeriesReceiptDto,
      ReorderSeriesError
    >(
      dependencies.prisma,
      async (transaction, rollback) => {
        await lockSeries(transaction, [command.seriesId]);
        const snapshot = await loadSeriesOrderSnapshot(
          transaction,
          command.seriesId,
        );
        if (snapshot === undefined) {
          return rollback({ code: "series_not_found" });
        }
        const currentIds = snapshot.items.map(({ materialId }) => materialId);
        const nextChapters: readonly GuideChapterEntry[] =
          command.chapters ?? snapshot.chapters;
        const chapterIds = new Set(nextChapters.map(({ id }) => id));
        const nextGroups =
          command.stepGroups ??
          keptPlacement(snapshot.items, ({ stepGroup }) => stepGroup, command.orderedMaterialIds);
        const nextAssignments = Object.fromEntries(
          Object.entries(
            command.chapterAssignments ??
              keptPlacement(
                snapshot.items,
                ({ chapterId }) => chapterId,
                command.orderedMaterialIds,
              ),
          ).filter(([, chapterId]) => chapterIds.has(chapterId)),
        );
        const nextEntries = command.orderedMaterialIds.map((materialId) => ({
          chapterId: nextAssignments[materialId] ?? null,
          materialId,
          stepGroup: nextGroups[materialId] ?? null,
        }));
        const currentOrderVersion = guideOrderVersion(
          snapshot.items,
          snapshot.chapters,
        );
        const nextOrderVersion = guideOrderVersion(nextEntries, nextChapters);
        if (currentOrderVersion === nextOrderVersion) {
          return { seriesId: command.seriesId, orderVersion: currentOrderVersion };
        }
        if (currentOrderVersion !== command.expectedOrderVersion) {
          return rollback({ code: "stale_series_order", currentOrderVersion });
        }
        if (snapshot.archived) {
          const currentSet = new Set(currentIds);
          const addedIndex = command.orderedMaterialIds.findIndex(
            (materialId) => !currentSet.has(materialId),
          );
          if (addedIndex >= 0) {
            return rollback({
              code: "invalid_reference",
              issues: [
                {
                  code: "series_archived",
                  path: `/orderedMaterialIds/${String(addedIndex)}`,
                },
              ],
            });
          }
        }
        const foundMaterials =
          command.orderedMaterialIds.length === 0
            ? []
            : await transaction.material.findMany({
                where: { id: { in: [...command.orderedMaterialIds] } },
                select: { id: true },
              });
        const foundMaterialIds = new Set(foundMaterials.map(({ id }) => id));
        const missingIndex = command.orderedMaterialIds.findIndex(
          (materialId) => !foundMaterialIds.has(materialId),
        );
        if (missingIndex >= 0) {
          return rollback({
            code: "invalid_reference",
            issues: [
              {
                code: "material_not_found",
                path: `/orderedMaterialIds/${String(missingIndex)}`,
              },
            ],
          });
        }
        const chapterIssues = [
          ...(await claimedChapterIssues(
            transaction,
            command.seriesId,
            command.chapters,
          )),
          ...unknownChapterIssues(command.chapterAssignments, chapterIds),
          ...guideChapterPlacementIssues(
            command.orderedMaterialIds,
            nextAssignments,
            nextChapters.map(({ id }) => id),
          ),
        ];
        if (chapterIssues.length > 0) {
          return rollback({ code: "invalid_reference", issues: chapterIssues });
        }
        await replaceGuideComposition(transaction, {
          chapterAssignments: nextAssignments,
          chapters: nextChapters,
          guideId: command.seriesId,
          orderedMaterialIds: command.orderedMaterialIds,
          stepGroups: nextGroups,
        });
        return {
          seriesId: command.seriesId,
          orderVersion: nextOrderVersion,
        };
      },
      mapPostgresReadError,
    );
  };
}

/** Keep the current value of retained Materials when the command omits the whole map. */
function keptPlacement<Item extends { readonly materialId: string }>(
  items: readonly Item[],
  select: (item: Item) => string | null,
  orderedMaterialIds: readonly string[],
): Record<string, string> {
  const kept = new Set(orderedMaterialIds);
  return Object.fromEntries(
    items.flatMap((item) => {
      const value = select(item);
      return value === null || !kept.has(item.materialId)
        ? []
        : [[item.materialId, value] as const];
    }),
  );
}

function unknownChapterIssues(
  chapterAssignments: Readonly<Record<string, string>> | undefined,
  chapterIds: ReadonlySet<string>,
): readonly ValidationIssue[] {
  return Object.entries(chapterAssignments ?? {}).flatMap(
    ([materialId, chapterId]) =>
      chapterIds.has(chapterId)
        ? []
        : [{ code: "guide_chapter_not_found", path: `/chapterAssignments/${materialId}` }],
  );
}

/** A chapter identifier already used by another Guide cannot be claimed by this one. */
async function claimedChapterIssues(
  transaction: MaterialsPrismaTransaction,
  guideId: string,
  chapters: readonly GuideChapterDraft[] | undefined,
): Promise<readonly ValidationIssue[]> {
  if (chapters === undefined || chapters.length === 0) {
    return [];
  }
  const claimed = await transaction.guideChapter.findMany({
    where: { id: { in: chapters.map(({ id }) => id) }, guideId: { not: guideId } },
    select: { id: true },
  });
  const claimedIds = new Set(claimed.map(({ id }) => id));
  return chapters.flatMap(({ id }, index) =>
    claimedIds.has(id)
      ? [{ code: "guide_chapter_claimed", path: `/chapters/${String(index)}/id` }]
      : [],
  );
}
