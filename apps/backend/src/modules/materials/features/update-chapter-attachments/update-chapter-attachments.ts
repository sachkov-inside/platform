import { z } from "zod";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import {
  lockSeries,
  loadSeriesOrderSnapshot,
} from "../../infrastructure/postgres/series-order.js";
import { productOrderVersion } from "../../shared/product-order-version.js";
import { authorizeManager } from "../../ports/author-policy.js";
import {
  accountId,
  entityId,
  parseCommand,
} from "../../shared/command-validation.js";
import {
  executeAuthoringTransaction,
  failure,
} from "../../shared/application-result.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type {
  ReorderSeriesReceiptDto,
  ReorderSeriesError,
  ReorderSeriesResult,
} from "../reorder-series/reorder-series.contract.js";

export const chapterAttachmentsBodySchema = z
  .object({
    expectedOrderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
    materialIds: z
      .array(z.uuid().transform((id) => id.toLowerCase()))
      .max(200)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Attachment IDs must be unique",
      ),
  })
  .strict();
const commandSchema = chapterAttachmentsBodySchema.extend({
  actor: accountId,
  productId: entityId,
  chapterId: entityId,
});
export type UpdateChapterAttachmentsOperation = (
  command: z.input<typeof commandSchema>,
) => Promise<ReorderSeriesResult>;

/** Platform-owned navigation links can change without changing source-owned content or programme. */
export function assembleUpdateChapterAttachments(
  dependencies: MaterialAuthoringDependencies,
): UpdateChapterAttachmentsOperation {
  return async (input) => {
    const parsed = parseCommand(commandSchema, input);
    if (!parsed.ok) return failure(parsed.error);
    const command = parsed.value;
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) return failure(authorization.error);
    return executeAuthoringTransaction<
      ReorderSeriesReceiptDto,
      ReorderSeriesError
    >(
      dependencies.prisma,
      async (transaction, rollback) => {
        await lockSeries(transaction, [command.productId]);
        const snapshot = await loadSeriesOrderSnapshot(
          transaction,
          command.productId,
        );
        if (snapshot === undefined)
          return rollback({ code: "series_not_found" });
        if (
          !snapshot.chapters.some(
            (chapter) => chapter.id === command.chapterId,
          ) ||
          command.materialIds.some(
            (id) => !snapshot.items.some((item) => item.materialId === id),
          )
        )
          return rollback({
            code: "invalid_reference",
            issues: [
              { code: "invalid_chapter_attachment", path: "/materialIds" },
            ],
          });
        const currentOrderVersion = productOrderVersion(
          snapshot.items,
          snapshot.chapters,
          snapshot.programmePlacements,
        );
        const chapters = snapshot.chapters.map((chapter) =>
          chapter.id === command.chapterId
            ? { ...chapter, supplementaryMaterialIds: command.materialIds }
            : chapter,
        );
        const next = productOrderVersion(
          snapshot.items,
          chapters,
          snapshot.programmePlacements,
        );
        if (next === currentOrderVersion)
          return { seriesId: command.productId, orderVersion: next };
        if (command.expectedOrderVersion !== currentOrderVersion)
          return rollback({ code: "stale_series_order", currentOrderVersion });
        await transaction.productChapterSupplementaryMaterial.deleteMany({
          where: { chapterId: command.chapterId, productId: command.productId },
        });
        if (command.materialIds.length > 0)
          await transaction.productChapterSupplementaryMaterial.createMany({
            data: command.materialIds.map((materialId, index) => ({
              chapterId: command.chapterId,
              productId: command.productId,
              materialId,
              ordinal: index + 1,
            })),
          });
        return { seriesId: command.productId, orderVersion: next };
      },
      mapPostgresReadError,
      "updateChapterAttachments",
    );
  };
}
