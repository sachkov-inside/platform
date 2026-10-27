import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { ProductAuthoringDependencies } from "../../facets/product-authoring/product-authoring.dependencies.js";
import { authorizeManager } from "../../../../infrastructure/content-authoring/author-policy.js";
import {
  failure,
  executeAuthoringTransaction,
} from "../../shared/application-result.js";
import {
  accountId,
  collectionSlug,
  parseCommand,
} from "../../shared/command-validation.js";
import {
  isPostgresUniqueViolation,
  mapPostgresReadError,
} from "../../../../infrastructure/content-authoring/postgres-error-mapping.js";
import { contentCollectionPersistence } from "../../infrastructure/postgres/content-collection-persistence.js";
import type { CreateContentCollectionOperation } from "./create-content-collection.contract.js";

export const contentCollectionInputSchema = z
  .object({
    actor: accountId,
    kind: z.enum(["product", "topic"]),
    name: z.string().trim().min(1).max(120),
    slug: collectionSlug,
    summary: z.string().trim().max(500),
  })
  .strict();

export function assembleCreateContentCollection(
  dependencies: ProductAuthoringDependencies,
): CreateContentCollectionOperation {
  return async (input) => {
    const parsed = parseCommand(contentCollectionInputSchema, input);
    if (!parsed.ok) return failure(parsed.error);
    const command = parsed.value;
    if (command.kind === "topic")
      return failure({
        code: "invalid_content",
        issues: [{ code: "invalid_product_kind", path: "/kind" }],
      });
    return executeAuthoringTransaction(
      dependencies.prisma,
      async (transaction, rollback) => {
        const permission = await authorizeManager(
          dependencies.authorPolicy,
          command.actor,
          transactionHandle(transaction),
        );
        if (!permission.ok) return rollback(permission.error);
        return contentCollectionPersistence(
          transaction,
          command.kind,
          dependencies,
        ).create({
          id: randomUUID(),
          name: command.name,
          slug: command.slug,
          summary: command.summary,
        });
      },
      (error) =>
        isPostgresUniqueViolation(error, "product_slug_unique")
          ? { code: "content_collection_slug_conflict" as const }
          : mapPostgresReadError(error),
      "createProduct",
    );
  };
}
