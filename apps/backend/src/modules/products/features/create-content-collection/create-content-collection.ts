import { randomUUID } from "node:crypto";
import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ProductAuthoringDependencies } from "../../facets/product-authoring/product-authoring.dependencies.js";
import { authorizeManager } from "../../../../infrastructure/content-authoring/author-policy.js";
import { failure } from "../../shared/application-result.js";
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
    kind: z.enum(["product", "series", "topic"]),
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
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      command.actor,
    );
    if (!authorization.ok) return failure(authorization.error);

    try {
      const data = {
        id: randomUUID(),
        name: command.name,
        slug: command.slug,
        summary: command.summary,
      };
      const persistence = contentCollectionPersistence(
        dependencies.prisma,
        command.kind,
        dependencies.loadCovers,
      );
      return { ok: true, value: await persistence.create(data) };
    } catch (error) {
      const constraint = contentCollectionPersistence(
        dependencies.prisma,
        command.kind,
        dependencies.loadCovers,
      ).slugConstraint;
      return failure(
        isPostgresUniqueViolation(error, constraint)
          ? { code: "content_collection_slug_conflict" }
          : dependencyFailure(
              { module: "products", operation: "createContentCollection" },
              error,
              mapPostgresReadError(error),
            ),
      );
    }
  };
}
