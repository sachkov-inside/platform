import { z } from "zod";

import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import type {
  ForbiddenError,
  InvalidContentError,
  InvalidReferenceError,
  SystemError,
} from "../../../../infrastructure/content-authoring/authoring-errors.js";
import type { Result } from "../../../../infrastructure/content-authoring/result.js";
import type { ProductsPrismaTransaction } from "../../../../infrastructure/prisma/index.js";
import type { ProductAuthoringDependencies } from "../../facets/product-authoring/product-authoring.dependencies.js";
import { lockProduct } from "../../infrastructure/postgres/product-order.js";
import { authorizeManager } from "../../../../infrastructure/content-authoring/author-policy.js";
import { mapPostgresReadError } from "../../../../infrastructure/content-authoring/postgres-error-mapping.js";
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
  normalizeProductRoadmap,
  productRoadmapDraftSchema,
  type ProductRoadmap,
  type ProductRoadmapReceiptDto,
} from "../../shared/product-roadmap.js";
import type { ProductNotFoundError } from "../load-product-order/load-product-order.contract.js";

type ValidationIssue = { readonly code: string; readonly path: string };

export const productRoadmapBodySchema = z
  .object({ roadmap: productRoadmapDraftSchema.nullable() })
  .strict();
const commandSchema = productRoadmapBodySchema.extend({
  actor: accountId,
  productId: entityId,
});

export type UpdateProductRoadmapError =
  | ForbiddenError
  | InvalidContentError
  | InvalidReferenceError
  | ProductNotFoundError
  | SystemError;
export type UpdateProductRoadmapOperation = (
  command: z.input<typeof commandSchema>,
) => Promise<Result<ProductRoadmapReceiptDto, UpdateProductRoadmapError>>;

/**
 * Replaces the whole roadmap of a Product, or deletes it with `null`. The roadmap is Platform
 * presentation of the programme, so source-owned and archived Products accept it, and it stays
 * outside the Product order version: a roadmap edit never makes a composition save stale.
 */
export function assembleUpdateProductRoadmap(
  dependencies: ProductAuthoringDependencies,
): UpdateProductRoadmapOperation {
  return async (input) => {
    const parsed = parseCommand(commandSchema, input);
    if (!parsed.ok) return failure(parsed.error);
    const { actor, productId } = parsed.value;
    const roadmap =
      parsed.value.roadmap === null
        ? null
        : normalizeProductRoadmap(parsed.value.roadmap);
    if (roadmap !== null) {
      const issues = upcomingLessonIssues(roadmap);
      if (issues.length > 0)
        return failure({ code: "invalid_content", issues });
    }

    return executeAuthoringTransaction<
      ProductRoadmapReceiptDto,
      UpdateProductRoadmapError
    >(
      dependencies.prisma,
      async (transaction, rollback) => {
        const permission = await authorizeManager(
          dependencies.authorPolicy,
          actor,
          transactionHandle(transaction),
        );
        if (!permission.ok) return rollback(permission.error);

        // The lock orders this write after a concurrent chapter change of the same Product.
        await lockProduct(transaction, [productId]);
        const product = await transaction.product.findUnique({
          where: { id: productId },
          select: { id: true },
        });
        if (product === null) return rollback({ code: "product_not_found" });

        if (roadmap === null) {
          await transaction.productRoadmap.deleteMany({ where: { productId } });
          return { productId, roadmap: null };
        }
        const issues = await chapterIssues(transaction, productId, roadmap);
        if (issues.length > 0)
          return rollback({ code: "invalid_reference", issues });

        const updatedOn = new Date(`${roadmap.updatedOn}T00:00:00.000Z`);
        await transaction.productRoadmap.upsert({
          where: { productId },
          create: { productId, updatedOn, chapters: roadmap.chapters },
          update: {
            updatedOn,
            chapters: roadmap.chapters,
            updatedAt: new Date(),
          },
        });
        return { productId, roadmap };
      },
      mapPostgresReadError,
      "updateProductRoadmap",
    );
  };
}

/** Upcoming lessons describe work in progress, so only a `writing` chapter lists them. */
function upcomingLessonIssues(
  roadmap: ProductRoadmap,
): readonly ValidationIssue[] {
  return roadmap.chapters.flatMap((chapter, index) =>
    chapter.status !== "writing" && chapter.upcomingLessons.length > 0
      ? [
          {
            code: "product_roadmap_upcoming_lessons_not_writing",
            path: `/roadmap/chapters/${String(index)}/upcomingLessons`,
          },
        ]
      : [],
  );
}

/** Every entry names a chapter of this Product, each chapter at most once. */
async function chapterIssues(
  transaction: ProductsPrismaTransaction,
  productId: string,
  roadmap: ProductRoadmap,
): Promise<readonly ValidationIssue[]> {
  const chapters = new Set(
    (
      await transaction.productChapter.findMany({
        where: { productId },
        select: { id: true },
      })
    ).map(({ id }) => id),
  );
  const seen = new Set<string>();
  return roadmap.chapters.flatMap(({ chapterId }, index) => {
    const path = `/roadmap/chapters/${String(index)}/chapterId`;
    if (!chapters.has(chapterId))
      return [{ code: "product_roadmap_chapter_not_in_product", path }];
    if (seen.has(chapterId))
      return [{ code: "product_roadmap_chapter_duplicate", path }];
    seen.add(chapterId);
    return [];
  });
}
