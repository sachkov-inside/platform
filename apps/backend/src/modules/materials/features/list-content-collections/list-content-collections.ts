import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { failure } from "../../shared/application-result.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import { contentCollectionPersistence } from "../../infrastructure/postgres/content-collection-persistence.js";
import type { ListContentCollectionsOperation } from "./list-content-collections.contract.js";

const querySchema = z
  .object({ actor: accountId, kind: z.enum(["product", "topic"]) })
  .strict();

export function assembleListContentCollections(
  dependencies: MaterialAuthoringDependencies,
): ListContentCollectionsOperation {
  return async (input) => {
    if (input.kind !== "topic")
      return dependencies.products.listContentCollections(input);
    const parsed = parseCommand(querySchema, input);
    if (!parsed.ok) return failure({ code: "forbidden" });
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      parsed.value.actor,
    );
    if (!authorization.ok) return failure(authorization.error);

    try {
      const topics = await contentCollectionPersistence(
        dependencies.prisma,
        parsed.value.kind,
      ).list();
      // A Topic is not held: its holder count is not a fact, not zero.
      return {
        ok: true,
        value: topics.map((topic) => ({ ...topic, holderCount: null })),
      };
    } catch (error) {
      return failure(
        dependencyFailure(
          { module: "materials", operation: "listContentCollections" },
          error,
          mapPostgresReadError(error),
        ),
      );
    }
  };
}
