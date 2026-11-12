import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import type { ProductsPrismaTransaction } from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import type { ProductAuthoringDependencies } from "../../facets/product-authoring/product-authoring.dependencies.js";
import {
  lockProduct,
  loadProductOrderSnapshot,
  replaceProductTopicMaterials,
} from "../../infrastructure/postgres/product-order.js";
import { productOrderVersion } from "../../shared/product-order-version.js";
import {
  inCatalogueOrder,
  productTopicDraftsSchema,
  type ProductTopicDraft,
  type ProductTopicEntry,
} from "../../shared/product-topics.js";
import { authorizeManager } from "../../../../infrastructure/content-authoring/author-policy.js";
import {
  accountId,
  entityId,
  parseCommand,
} from "../../shared/command-validation.js";
import {
  executeAuthoringTransaction,
  failure,
} from "../../shared/application-result.js";
import { mapPostgresReadError } from "../../../../infrastructure/content-authoring/postgres-error-mapping.js";
import type {
  ReorderProductReceiptDto,
  ReorderProductError,
  ReorderProductResult,
} from "../reorder-product/reorder-product.contract.js";

type ValidationIssue = { readonly code: string; readonly path: string };

export const productTopicsBodySchema = z
  .object({
    expectedOrderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
    topics: productTopicDraftsSchema,
  })
  .strict();
const commandSchema = productTopicsBodySchema.extend({
  actor: accountId,
  productId: entityId,
});
export type UpdateProductTopicsOperation = (
  command: z.input<typeof commandSchema>,
) => Promise<ReorderProductResult>;

/**
 * Replaces the complete ordered list of Product topics and their Materials. Like chapter
 * attachments, topics are Platform navigation, so source-owned and archived Products accept them
 * without changing their catalogue, programme or source originals.
 */
export function assembleUpdateProductTopics(
  dependencies: ProductAuthoringDependencies,
): UpdateProductTopicsOperation {
  return async (input) => {
    const parsed = parseCommand(commandSchema, input);
    if (!parsed.ok) return failure(parsed.error);
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
        const snapshot = await loadProductOrderSnapshot(
          transaction,
          command.productId,
          dependencies.materials,
        );
        if (snapshot === undefined)
          return rollback({ code: "product_not_found" });
        const catalogue = snapshot.items.map(({ materialId }) => materialId);
        const issues = [
          ...topicMaterialIssues(command.topics, new Set(catalogue)),
          ...(await claimedTopicIssues(
            transaction,
            command.productId,
            command.topics,
          )),
        ];
        if (issues.length > 0)
          return rollback({ code: "invalid_reference", issues });

        const topics: readonly ProductTopicEntry[] = command.topics.map(
          (topic) => ({
            ...topic,
            materialIds: inCatalogueOrder(topic.materialIds, catalogue),
          }),
        );
        const currentOrderVersion = productOrderVersion(
          snapshot.items,
          snapshot.chapters,
          snapshot.programmePlacements,
          snapshot.topics,
        );
        const next = productOrderVersion(
          snapshot.items,
          snapshot.chapters,
          snapshot.programmePlacements,
          topics,
        );
        if (next === currentOrderVersion)
          return { productId: command.productId, orderVersion: next };
        if (command.expectedOrderVersion !== currentOrderVersion)
          return rollback({ code: "stale_product_order", currentOrderVersion });

        await replaceProductTopics(transaction, command.productId, topics);
        await replaceProductTopicMaterials(
          transaction,
          command.productId,
          topics,
        );
        return { productId: command.productId, orderVersion: next };
      },
      mapPostgresReadError,
      "updateProductTopics",
    );
  };
}

/** Every Material belongs to the Product catalogue and to at most one of its topics. */
function topicMaterialIssues(
  topics: readonly ProductTopicDraft[],
  catalogue: ReadonlySet<string>,
): readonly ValidationIssue[] {
  const claimed = new Set<string>();
  return topics.flatMap((topic, topicIndex) =>
    topic.materialIds.flatMap((materialId, index) => {
      const path = `/topics/${String(topicIndex)}/materialIds/${String(index)}`;
      if (!catalogue.has(materialId))
        return [{ code: "product_topic_material_not_in_product", path }];
      if (claimed.has(materialId))
        return [{ code: "product_topic_material_claimed", path }];
      claimed.add(materialId);
      return [];
    }),
  );
}

/** A topic identifier already used by another Product cannot be claimed by this one. */
async function claimedTopicIssues(
  transaction: ProductsPrismaTransaction,
  productId: string,
  topics: readonly ProductTopicDraft[],
): Promise<readonly ValidationIssue[]> {
  if (topics.length === 0) return [];
  const claimed = new Set(
    (
      await transaction.productTopic.findMany({
        where: {
          id: { in: topics.map(({ id }) => id) },
          productId: { not: productId },
        },
        select: { id: true },
      })
    ).map(({ id }) => id),
  );
  return topics.flatMap(({ id }, index) =>
    claimed.has(id)
      ? [{ code: "product_topic_claimed", path: `/topics/${String(index)}/id` }]
      : [],
  );
}

/**
 * Topics keep their identity across renames and reordering, so kept rows are updated in place.
 * Deleting a topic removes its Material assignments through the foreign key, never a Material.
 * The (product_id, ordinal) constraint is deferred, so positions may swap inside the transaction.
 */
async function replaceProductTopics(
  transaction: ProductsPrismaTransaction,
  productId: string,
  topics: readonly ProductTopicEntry[],
): Promise<void> {
  const existing = await transaction.productTopic.findMany({
    where: { productId },
    select: { id: true },
  });
  const kept = new Set(topics.map(({ id }) => id));
  const removed = existing.flatMap(({ id }) => (kept.has(id) ? [] : [id]));
  if (removed.length > 0)
    await transaction.productTopic.deleteMany({
      where: { productId, id: { in: removed } },
    });
  const known = new Set(existing.map(({ id }) => id));
  const updatedAt = new Date();
  for (const [index, { id, name, summary }] of topics.entries()) {
    const ordinal = index + 1;
    if (known.has(id))
      await transaction.productTopic.update({
        where: { id },
        data: { name, ordinal, summary, updatedAt },
      });
    else
      await transaction.productTopic.create({
        data: { id, productId, name, ordinal, summary },
      });
  }
}
