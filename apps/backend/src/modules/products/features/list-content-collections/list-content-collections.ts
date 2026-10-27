import { z } from "zod";

import {
  dependencyFailure,
  reportDependencyFailure,
} from "../../../../infrastructure/observability/index.js";
import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import type { ProductAuthoringDependencies } from "../../facets/product-authoring/product-authoring.dependencies.js";
import { authorizeManager } from "../../../../infrastructure/content-authoring/author-policy.js";
import { failure } from "../../shared/application-result.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../../../infrastructure/content-authoring/postgres-error-mapping.js";
import { contentCollectionPersistence } from "../../infrastructure/postgres/content-collection-persistence.js";
import type { ListContentCollectionsOperation } from "./list-content-collections.contract.js";

/** The bound of one `countProductHolders` call. */
const HOLDER_COUNT_CHUNK = 100;

const querySchema = z
  .object({ actor: accountId, kind: z.enum(["product", "topic"]) })
  .strict();

export function assembleListContentCollections(
  dependencies: ProductAuthoringDependencies,
): ListContentCollectionsOperation {
  return async (input) => {
    const parsed = parseCommand(querySchema, input);
    if (!parsed.ok) return failure({ code: "forbidden" });
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      parsed.value.actor,
    );
    if (!authorization.ok) return failure(authorization.error);

    try {
      const collections = await contentCollectionPersistence(
        dependencies.prisma,
        parsed.value.kind,
        dependencies,
      ).list();
      const holders =
        parsed.value.kind === "product"
          ? await countHolders(dependencies, parsed.value.actor, collections)
          : new Map<string, number>();
      return {
        ok: true,
        value: collections.map((collection) => ({
          ...collection,
          holderCount: holders.get(collection.id) ?? null,
        })),
      };
    } catch (error) {
      return failure(
        dependencyFailure(
          { module: "products", operation: "listContentCollections" },
          error,
          mapPostgresReadError(error),
        ),
      );
    }
  };
}

/**
 * The owner's holder count, one call per 100 Products, only for an actor with the right of
 * Product holder reads. An unanswered count or a missing right leaves it absent, never 0.
 */
async function countHolders(
  dependencies: Pick<
    ProductAuthoringDependencies,
    "prisma" | "productAccessHolders" | "holderCountPolicy"
  >,
  actor: string,
  collections: readonly { readonly id: string }[],
): Promise<ReadonlyMap<string, number>> {
  const { productAccessHolders: holders, holderCountPolicy: policy } =
    dependencies;
  if (holders === undefined || policy === undefined || collections.length === 0)
    return new Map();
  const counts = new Map<string, number>();
  try {
    if (!(await policy.canReadHolderCounts(actor))) return counts;
    for (
      let start = 0;
      start < collections.length;
      start += HOLDER_COUNT_CHUNK
    ) {
      const chunk = await holders.countProductHolders(
        transactionHandle(dependencies.prisma),
        collections
          .slice(start, start + HOLDER_COUNT_CHUNK)
          .map(({ id }) => id),
      );
      for (const [id, count] of chunk) counts.set(id.toLowerCase(), count);
    }
    return counts;
  } catch (error) {
    reportDependencyFailure(
      { module: "products", operation: "listContentCollections" },
      error,
    );
    return new Map();
  }
}
