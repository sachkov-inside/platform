import {
  checkContentWrite,
  contentWriter,
} from "../../domain/content-write-policy.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  lockMaterialReferenceChanges,
  type MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";

import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import type { ValidationIssue } from "../../domain/material-body/material-body.js";
import {
  loadSeriesOrderSnapshot,
  lockSeries,
  replaceProductComposition,
} from "../../infrastructure/postgres/series-order.js";
import { authorizeManager } from "../../ports/author-policy.js";
import {
  executeAuthoringTransaction,
  failure,
} from "../../shared/application-result.js";
import {
  accountId,
  entityId,
  parseCommand,
} from "../../shared/command-validation.js";
import {
  productProgrammePlacementsSchema,
  type ProductProgrammePlacement,
  productChapterAssignmentsSchema,
  productChapterDraftsSchema,
  type ProductChapterDraft,
} from "../../shared/product-chapters.js";
import {
  productOrderVersion,
  type ProductChapterEntry,
} from "../../shared/product-order-version.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { seriesStepGroupsSchema } from "../../shared/series-step-groups.js";
import {
  heldProductRemovals,
  recordProductRemovals,
  unconfirmedProductRemovals,
} from "../../shared/product-removal-confirmation.js";
import { productChapterPlacementIssues } from "./product-chapter-placement.js";
import type {
  ReorderSeriesError,
  ReorderSeriesOperation,
  ReorderSeriesReceiptDto,
} from "./reorder-series.contract.js";

export const reorderSeriesCommandSchema = z
  .object({
    actor: accountId,
    programmePlacements: productProgrammePlacementsSchema.optional(),
    chapters: productChapterDraftsSchema.optional(),
    chapterAssignments: productChapterAssignmentsSchema.optional(),
    expectedOrderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
    orderedMaterialIds: z.array(entityId),
    stepGroups: seriesStepGroupsSchema.optional(),
    seriesId: entityId,
    confirmedProductRemovals: z.array(z.uuid()).max(100).optional().default([]),
  })
  .strict()
  .refine(
    ({ orderedMaterialIds }) =>
      new Set(orderedMaterialIds).size === orderedMaterialIds.length,
    { path: ["orderedMaterialIds"], message: "Material IDs must be unique" },
  )
  .refine(
    ({ orderedMaterialIds, stepGroups }) =>
      Object.keys(stepGroups ?? {}).every((id) =>
        orderedMaterialIds.includes(id),
      ),
    {
      path: ["stepGroups"],
      message: "Step groups must reference composition members",
    },
  )
  .refine(
    ({ chapterAssignments, orderedMaterialIds }) =>
      Object.keys(chapterAssignments ?? {}).every((id) =>
        orderedMaterialIds.includes(id),
      ),
    {
      path: ["chapterAssignments"],
      message: "Chapter placement must reference composition members",
    },
  );

export function assembleReorderSeries(
  dependencies: MaterialAuthoringDependencies,
  sourceId: string | null = null,
): ReorderSeriesOperation {
  return async (input) => {
    const parsed = parseCommand(reorderSeriesCommandSchema, input);
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
        const source = await transaction.product.findUnique({
          where: { id: command.seriesId },
          select: { sourceId: true },
        });
        const snapshot = await loadSeriesOrderSnapshot(
          transaction,
          command.seriesId,
        );
        if (snapshot === undefined) {
          return rollback({ code: "series_not_found" });
        }
        const currentIds = snapshot.items.map(({ materialId }) => materialId);
        await lockMaterialReferenceChanges(transaction, [
          ...new Set([...currentIds, ...command.orderedMaterialIds]),
        ]);
        const foundMaterials =
          command.orderedMaterialIds.length === 0
            ? []
            : await transaction.material.findMany({
                where: { id: { in: [...command.orderedMaterialIds] } },
                select: { id: true, sourceId: true },
              });
        const added = foundMaterials.filter(
          ({ id }) => !currentIds.includes(id),
        );
        const sourceError = checkContentWrite(contentWriter(sourceId), [
          {
            kind: "product",
            sourceId: source?.sourceId ?? null,
            path: "/seriesId",
          },
          ...added.map((material) => ({
            kind: "membership" as const,
            sourceId: material.sourceId,
            path: `/orderedMaterialIds/${String(command.orderedMaterialIds.indexOf(material.id))}`,
          })),
        ]);
        if (sourceError !== null) return rollback(sourceError);
        const nextChapters: readonly ProductChapterEntry[] = (
          command.chapters ?? snapshot.chapters
        ).map((chapter) => ({
          ...chapter,
          supplementaryMaterialIds:
            chapter.supplementaryMaterialIds ??
            snapshot.chapters.find((entry) => entry.id === chapter.id)
              ?.supplementaryMaterialIds ??
            [],
        }));
        const chapterIds = new Set(nextChapters.map(({ id }) => id));
        const nextGroups =
          command.stepGroups ??
          keptPlacement(
            snapshot.items,
            ({ stepGroup }) => stepGroup,
            command.orderedMaterialIds,
          );
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
        const nextProgramme =
          command.programmePlacements ??
          (snapshot.programmeExplicit && nextChapters.length === 0
            ? snapshot.programmePlacements.filter((entry) =>
                command.orderedMaterialIds.includes(entry.materialId),
              )
            : legacyProgrammePlacements(
                snapshot.programmePlacements,
                snapshot.items.map((item) => item.materialId),
                command.orderedMaterialIds,
                nextAssignments,
                nextGroups,
                nextChapters.map((chapter) => chapter.id),
              ));
        const programmeAssignments = Object.fromEntries(
          nextProgramme
            .slice()
            .reverse()
            .flatMap((entry) =>
              entry.chapterId === null
                ? []
                : [[entry.materialId, entry.chapterId]],
            ),
        );
        const nextEntries = command.orderedMaterialIds.map((materialId) => ({
          chapterId: programmeAssignments[materialId] ?? null,
          materialId,
          stepGroup: nextGroups[materialId] ?? null,
        }));
        const currentOrderVersion = productOrderVersion(
          snapshot.items,
          snapshot.chapters,
          snapshot.programmePlacements,
        );
        const nextOrderVersion = productOrderVersion(
          nextEntries,
          nextChapters,
          nextProgramme,
        );
        if (currentOrderVersion === nextOrderVersion) {
          if (
            command.programmePlacements !== undefined &&
            !snapshot.programmeExplicit
          ) {
            await transaction.product.update({
              where: { id: command.seriesId },
              data: { programmeExplicit: true },
            });
          }
          return {
            seriesId: command.seriesId,
            orderVersion: currentOrderVersion,
          };
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
        const removedIds = currentIds.filter(
          (id) => !command.orderedMaterialIds.includes(id),
        );
        if (removedIds.length > 0) {
          const protectedMaterials = await transaction.material.findMany({
            where: {
              id: { in: removedIds },
              sourceId: { not: null },
              publicationState: "published",
              showInFeed: true,
              access: { not: "free" },
            },
            select: { id: true },
          });
          for (const material of protectedMaterials) {
            const other = await transaction.productMembership.findFirst({
              where: {
                materialId: material.id,
                seriesId: { not: command.seriesId },
              },
              select: { seriesId: true },
            });
            if (other === null)
              return rollback({
                code: "invalid_reference",
                issues: [
                  {
                    code: "standalone_feed_material_must_be_free",
                    path: "/orderedMaterialIds",
                  },
                ],
              });
          }
        }
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
        const claimedPlacements =
          nextProgramme.length === 0
            ? []
            : await transaction.productProgrammePlacement.findMany({
                where: {
                  id: { in: nextProgramme.map((entry) => entry.id) },
                  productId: { not: command.seriesId },
                },
                select: { id: true },
              });
        const chapterIssues = [
          ...claimedPlacements.map((entry) => ({
            code: "programme_placement_claimed",
            path: `/programmePlacements/${String(nextProgramme.findIndex((placement) => placement.id === entry.id))}/id`,
          })),
          ...nextProgramme.flatMap((entry, index) =>
            !command.orderedMaterialIds.includes(entry.materialId) ||
            (entry.chapterId !== null && !chapterIds.has(entry.chapterId))
              ? [
                  {
                    code: "invalid_programme_placement",
                    path: `/programmePlacements/${String(index)}`,
                  },
                ]
              : [],
          ),
          ...productChapterPlacementIssues(
            nextProgramme.map((entry) => entry.id),
            Object.fromEntries(
              nextProgramme.flatMap((entry) =>
                entry.chapterId === null ? [] : [[entry.id, entry.chapterId]],
              ),
            ),
            nextChapters.map((chapter) => chapter.id),
          ),
          ...nextChapters.flatMap((chapter, index) =>
            (chapter.supplementaryMaterialIds ?? []).flatMap((id) =>
              !command.orderedMaterialIds.includes(id)
                ? [
                    {
                      code: "supplementary_material_not_in_product",
                      path: `/chapters/${String(index)}/supplementaryMaterialIds`,
                    },
                  ]
                : [],
            ),
          ),
          ...(await claimedChapterIssues(
            transaction,
            command.seriesId,
            command.chapters,
          )),
          ...unknownChapterIssues(command.chapterAssignments, chapterIds),
          ...(command.programmePlacements === undefined
            ? productChapterPlacementIssues(
                command.orderedMaterialIds,
                nextAssignments,
                nextChapters.map(({ id }) => id),
              )
            : []),
        ];
        if (chapterIssues.length > 0) {
          return rollback({ code: "invalid_reference", issues: chapterIssues });
        }
        // Опубликованный материал уходит из руководства с держателями права только подтверждением.
        const removedMaterialIds = (
          await transaction.publishedMaterialProductMembership.findMany({
            where: { seriesId: command.seriesId },
            select: { materialId: true },
          })
        )
          .map(({ materialId }) => materialId)
          .filter(
            (materialId) => !command.orderedMaterialIds.includes(materialId),
          );
        const heldRemovals =
          removedMaterialIds.length === 0
            ? []
            : await heldProductRemovals(
                transaction,
                dependencies.productAccessHolders,
                [command.seriesId],
              );
        const unconfirmed = unconfirmedProductRemovals(
          heldRemovals,
          command.confirmedProductRemovals,
        );
        if (unconfirmed.length > 0) {
          return rollback({
            code: "product_removal_confirmation_required",
            products: unconfirmed,
          });
        }
        if (
          command.programmePlacements !== undefined &&
          !snapshot.programmeExplicit
        ) {
          await transaction.product.update({
            where: { id: command.seriesId },
            data: { programmeExplicit: true },
          });
        }
        await replaceProductComposition(transaction, {
          chapterAssignments: programmeAssignments,
          chapters: nextChapters,
          productId: command.seriesId,
          orderedMaterialIds: command.orderedMaterialIds,
          stepGroups: nextGroups,
          programmePlacements: nextProgramme,
        });
        await recordProductRemovals(transaction, {
          actor: command.actor,
          operation: "product_composition",
          removals: heldRemovals.flatMap((product) =>
            removedMaterialIds.map((materialId) => ({ product, materialId })),
          ),
          removedAt: new Date(),
        });
        return {
          seriesId: command.seriesId,
          orderVersion: nextOrderVersion,
        };
      },
      mapPostgresReadError,
      "reorderSeries",
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
        : [
            {
              code: "product_chapter_not_found",
              path: `/chapterAssignments/${materialId}`,
            },
          ],
  );
}

/** A chapter identifier already used by another Product cannot be claimed by this one. */
async function claimedChapterIssues(
  transaction: MaterialsPrismaTransaction,
  productId: string,
  chapters: readonly ProductChapterDraft[] | undefined,
): Promise<readonly ValidationIssue[]> {
  if (chapters === undefined || chapters.length === 0) {
    return [];
  }
  const claimed = await transaction.productChapter.findMany({
    where: {
      id: { in: chapters.map(({ id }) => id) },
      productId: { not: productId },
    },
    select: { id: true },
  });
  const claimedIds = new Set(claimed.map(({ id }) => id));
  return chapters.flatMap(({ id }, index) =>
    claimedIds.has(id)
      ? [
          {
            code: "product_chapter_claimed",
            path: `/chapters/${String(index)}/id`,
          },
        ]
      : [],
  );
}

/** Legacy commands replace primary slots while keeping repeat slots in their authored positions. */
function legacyProgrammePlacements(
  current: readonly ProductProgrammePlacement[],
  currentMaterialIds: readonly string[],
  materialIds: readonly string[],
  assignments: Readonly<Record<string, string>>,
  groups: Readonly<Record<string, string>>,
  chapterIds: readonly string[],
): readonly ProductProgrammePlacement[] {
  const primary = new Map<string, ProductProgrammePlacement>();
  for (const entry of current) {
    if (!primary.has(entry.materialId)) primary.set(entry.materialId, entry);
  }
  const main = materialIds.flatMap((materialId) => {
    const chapterId = assignments[materialId] ?? null;
    if (chapterIds.length > 0 && chapterId === null) return [];
    return [
      {
        id: primary.get(materialId)?.id ?? randomUUID(),
        materialId,
        chapterId,
        stepGroup: groups[materialId] ?? null,
      },
    ];
  });
  const catalogueUnchanged =
    materialIds.length === currentMaterialIds.length &&
    materialIds.every((id, index) => id === currentMaterialIds[index]);
  const primaryUnchanged =
    main.length === primary.size &&
    main.every((entry) => {
      const previous = primary.get(entry.materialId);
      return (
        previous?.chapterId === entry.chapterId &&
        previous.stepGroup === entry.stepGroup
      );
    });
  if (catalogueUnchanged && primaryUnchanged) {
    return [...current]
      .filter((entry) =>
        chapterIds.length === 0
          ? entry.chapterId === null
          : chapterIds.includes(entry.chapterId ?? ""),
      )
      .sort(
        (left, right) =>
          chapterIds.indexOf(left.chapterId ?? "") -
          chapterIds.indexOf(right.chapterId ?? ""),
      );
  }
  const retainedMembers = new Set(materialIds);
  const chapters: readonly (string | null)[] =
    chapterIds.length === 0 ? [null] : chapterIds;
  return chapters.flatMap((chapterId) => {
    const desiredPrimary = main.filter(
      (entry) => entry.chapterId === chapterId,
    );
    let primaryIndex = 0;
    const entries = current.flatMap((entry) => {
      if (entry.chapterId !== chapterId) return [];
      if (entry.id === primary.get(entry.materialId)?.id) {
        const replacement = desiredPrimary[primaryIndex++];
        return replacement === undefined ? [] : [replacement];
      }
      return retainedMembers.has(entry.materialId) ? [entry] : [];
    });
    return [...entries, ...desiredPrimary.slice(primaryIndex)];
  });
}
