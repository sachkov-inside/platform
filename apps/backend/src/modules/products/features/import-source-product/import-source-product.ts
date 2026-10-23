import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import { executeAuthoringTransaction } from "../../shared/application-result.js";
import { randomUUID } from "node:crypto";
import type { ProductAuthoringDependencies } from "../../facets/product-authoring/product-authoring.dependencies.js";
import { contentCollectionPersistence } from "../../infrastructure/postgres/content-collection-persistence.js";
import { authorizeManager } from "../../../../infrastructure/content-authoring/author-policy.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import {
  isPostgresUniqueViolation,
  mapPostgresReadError,
} from "../../../../infrastructure/content-authoring/postgres-error-mapping.js";
import { assembleReorderSeries } from "../reorder-series/reorder-series.js";
import { assembleUpdateContentCollection } from "../update-content-collection/update-content-collection.js";
import {
  reserveSourceProductBodySchema,
  reorderSourceProductBodySchema,
  updateSourceProductBodySchema,
  validateSourceProductBodySchema,
  type ReserveSourceProductOperation,
  type ReorderSourceProductOperation,
  type UpdateSourceProductOperation,
  type ValidateSourceProductOperation,
} from "./import-source-product.contract.js";

export function assembleReserveSourceProduct(
  dependencies: ProductAuthoringDependencies,
): ReserveSourceProductOperation {
  return async (input) => {
    const parsed = parseCommand(
      reserveSourceProductBodySchema.extend({ actor: accountId }),
      input,
    );
    if (!parsed.ok) return parsed;
    const command = parsed.value;
    return executeAuthoringTransaction(
      dependencies.prisma,
      async (transaction, rollback) => {
        const permission = await authorizeManager(
          dependencies.authorPolicy,
          command.actor,
          transactionHandle(transaction),
        );
        if (!permission.ok) return rollback(permission.error);
        const current = await transaction.product.upsert({
          where: { sourceId: command.sourceId },
          create: {
            id: randomUUID(),
            sourceId: command.sourceId,
            name: command.name,
            slug: command.slug,
            summary: command.summary,
          },
          update: {},
        });
        const result = await contentCollectionPersistence(
          transaction,
          "product",
          dependencies.loadCovers,
        ).load(current.id);
        if (result === undefined)
          throw new Error("Reserved Product disappeared");
        return result;
      },
      (error) =>
        isPostgresUniqueViolation(error, "series_slug_unique")
          ? { code: "content_collection_slug_conflict" as const }
          : mapPostgresReadError(error),
      "reserveSourceProduct",
    );
  };
}

/** Только проверка описания и оформления: ничего не читает и не пишет. */
export function assembleValidateSourceProduct(
  dependencies: ProductAuthoringDependencies,
): ValidateSourceProductOperation {
  return async (input) => {
    const parsed = parseCommand(
      validateSourceProductBodySchema.extend({ actor: accountId }),
      input,
    );
    if (!parsed.ok) return parsed;
    const authorized = await authorizeManager(
      dependencies.authorPolicy,
      parsed.value.actor,
    );
    if (!authorized.ok) return authorized;
    return { ok: true, value: { valid: true } };
  };
}

export function assembleUpdateSourceProduct(
  dependencies: ProductAuthoringDependencies,
): UpdateSourceProductOperation {
  return async (input) => {
    const parsed = parseCommand(
      updateSourceProductBodySchema.extend({ actor: accountId }),
      input,
    );
    if (!parsed.ok) return parsed;
    const { sourceId, ...command } = parsed.value;
    return assembleUpdateContentCollection(
      dependencies,
      sourceId,
    )({ ...command, kind: "product" });
  };
}

export function assembleReorderSourceProduct(
  dependencies: ProductAuthoringDependencies,
): ReorderSourceProductOperation {
  return async (input) => {
    const parsed = parseCommand(
      reorderSourceProductBodySchema.extend({ actor: accountId }),
      input,
    );
    if (!parsed.ok) return parsed;
    const { sourceId, ...command } = parsed.value;
    return assembleReorderSeries(dependencies, sourceId)(command);
  };
}
