import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ProductAuthoringDependencies } from "../../facets/product-authoring/product-authoring.dependencies.js";
import { authorizeManager } from "../../../../infrastructure/content-authoring/author-policy.js";
import { failure } from "../../shared/application-result.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../../../infrastructure/content-authoring/postgres-error-mapping.js";
import { contentCollectionPersistence } from "../../infrastructure/postgres/content-collection-persistence.js";
import type { ListContentCollectionsOperation } from "./list-content-collections.contract.js";

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
      return {
        ok: true,
        value: await contentCollectionPersistence(
          dependencies.prisma,
          parsed.value.kind,
          dependencies.loadCovers,
        ).list(),
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
