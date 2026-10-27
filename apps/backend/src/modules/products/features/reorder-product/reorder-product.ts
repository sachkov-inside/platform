import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import {
  checkContentWrite,
  contentWriter,
} from "../../../../infrastructure/content-authoring/content-write-policy.js";
import { z } from "zod";

import { type ProductsPrismaTransaction } from "../../../../infrastructure/prisma/index.js";

import type { ProductAuthoringDependencies } from "../../facets/product-authoring/product-authoring.dependencies.js";
type ValidationIssue = { readonly code: string; readonly path: string };
import {
  loadProductOrderSnapshot,
  lockProduct,
  replaceProductComposition,
} from "../../infrastructure/postgres/product-order.js";
import { authorizeManager } from "../../../../infrastructure/content-authoring/author-policy.js";
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
import { mapPostgresReadError } from "../../../../infrastructure/content-authoring/postgres-error-mapping.js";
import { productStepGroupsSchema } from "../../shared/product-step-groups.js";
import {
  heldProductRemovals,
  recordProductRemovals,
  unconfirmedProductRemovals,
} from "../../shared/product-removal-confirmation.js";
import { productChapterPlacementIssues } from "./product-chapter-placement.js";
import type {
  ReorderProductError,
  ReorderProductOperation,
  ReorderProductReceiptDto,
} from "./reorder-product.contract.js";

export const reorderProductCommandSchema = z
  .object({
    actor: accountId,
    programmePlacements: productProgrammePlacementsSchema.optional(),
    chapters: productChapterDraftsSchema.optional(),
    chapterAssignments: productChapterAssignmentsSchema.optional(),
    expectedOrderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
    orderedMaterialIds: z.array(entityId),
    stepGroups: productStepGroupsSchema.optional(),
    productId: entityId,
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

export function assembleReorderProduct(
  dependencies: ProductAuthoringDependencies,
  sourceId: string | null = null,
): ReorderProductOperation {
  return async (input) => {
    const parsed = parseCommand(reorderProductCommandSchema, input);
    if (!parsed.ok) {
      return failure(parsed.error);
    }
    const command = parsed.value;

    return executeAuthoringTransaction<
      ReorderProductReceiptDto,
      ReorderProductError
    >(
      dependencies.prisma,
      async (transaction, rollback) => {
        const permission = await authorizeManager(
          dependencies.authorPolicy,
          command.actor,
          transactionHandle(transaction),
        );
        if (!permission.ok) return rollback(permission.error);

        await lockProduct(transaction, [command.productId]);
        const source = await transaction.product.findUnique({
          where: { id: command.productId },
          select: { sourceId: true },
        });
        const snapshot = await loadProductOrderSnapshot(
          transaction,
          command.productId,
          dependencies.materials,
        );
        if (snapshot === undefined) {
          return rollback({ code: "product_not_found" });
        }
        const currentIds = snapshot.items.map(({ materialId }) => materialId);
        await dependencies.materials.lockReferences(
          [...new Set([...currentIds, ...command.orderedMaterialIds])],
          transactionHandle(transaction),
        );
        const foundMaterials = await dependencies.materials.load(
          command.orderedMaterialIds,
          transactionHandle(transaction),
        );
        const added = foundMaterials.filter(
          ({ id }) => !currentIds.includes(id),
        );
        const sourceError = checkContentWrite(contentWriter(sourceId), [
          {
            kind: "product",
            sourceId: source?.sourceId ?? null,
            path: "/productId",
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
        const nextProgramme =
          command.programmePlacements ??
          retainedProgrammePlacements(
            snapshot.programmePlacements,
            command.orderedMaterialIds,
            command.chapterAssignments,
            command.stepGroups,
            nextChapters.map((chapter) => chapter.id),
          );
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
        const catalogueOrder = [...command.orderedMaterialIds].sort(
          (left, right) => {
            const a = nextProgramme.findIndex(
                (entry) => entry.materialId === left,
              ),
              b = nextProgramme.findIndex(
                (entry) => entry.materialId === right,
              );
            const first = a < 0 ? Number.MAX_SAFE_INTEGER : a;
            const second = b < 0 ? Number.MAX_SAFE_INTEGER : b;
            return first !== second
              ? first - second
              : left.localeCompare(right);
          },
        );
        const nextEntries = catalogueOrder.map((materialId) => {
          const primary = nextProgramme.find(
            (entry) => entry.materialId === materialId,
          );
          return {
            materialId,
            chapterId: primary?.chapterId ?? null,
            stepGroup: primary?.stepGroup ?? null,
          };
        });
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
          return {
            productId: command.productId,
            orderVersion: currentOrderVersion,
          };
        }
        if (currentOrderVersion !== command.expectedOrderVersion) {
          return rollback({ code: "stale_product_order", currentOrderVersion });
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
                  code: "product_archived",
                  path: `/orderedMaterialIds/${String(addedIndex)}`,
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
                  productId: { not: command.productId },
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
            command.productId,
            command.chapters,
          )),
          ...unknownChapterIssues(command.chapterAssignments, chapterIds),
        ];
        if (chapterIssues.length > 0) {
          return rollback({ code: "invalid_reference", issues: chapterIssues });
        }
        // Опубликованный материал уходит из руководства с держателями права только подтверждением.
        const removedMaterialIds = (
          await transaction.publishedMaterialProductMembership.findMany({
            where: { productId: command.productId },
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
                [command.productId],
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
        await replaceProductComposition(transaction, dependencies.materials, {
          chapterAssignments: programmeAssignments,
          chapters: nextChapters,
          productId: command.productId,
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
          productId: command.productId,
          orderVersion: nextOrderVersion,
        };
      },
      mapPostgresReadError,
      "reorderProduct",
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
  transaction: ProductsPrismaTransaction,
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

/** Catalogue changes retain authored occurrences; only an explicit programme can add slots. */
function retainedProgrammePlacements(
  current: readonly ProductProgrammePlacement[],
  materialIds: readonly string[],
  assignments: Readonly<Record<string, string>> | undefined,
  groups: Readonly<Record<string, string>> | undefined,
  chapterIds: readonly string[],
): readonly ProductProgrammePlacement[] {
  const retained = new Set(materialIds);
  return current
    .filter((entry) => retained.has(entry.materialId))
    .map((entry) => ({
      ...entry,
      chapterId:
        chapterIds.length === 0
          ? null
          : assignments === undefined
            ? entry.chapterId
            : (assignments[entry.materialId] ?? null),
      stepGroup:
        groups === undefined
          ? entry.stepGroup
          : (groups[entry.materialId] ?? null),
    }))
    .sort(
      (left, right) =>
        chapterIds.indexOf(left.chapterId ?? "") -
        chapterIds.indexOf(right.chapterId ?? ""),
    );
}
