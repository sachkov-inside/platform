import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { authorizeManager } from "../../../../infrastructure/content-authoring/author-policy.js";
import { mapPostgresReadError } from "../../../../infrastructure/content-authoring/postgres-error-mapping.js";
import type { ProductAuthoringDependencies } from "../../facets/product-authoring/product-authoring.dependencies.js";
import { failure } from "../../shared/application-result.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import type { SearchAuthoringProductsOperation } from "./search-authoring-products.contract.js";

const querySchema = z
  .object({
    actor: accountId,
    query: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .transform((value) => value.replace(/\s+/gu, " ")),
    limit: z.number().int().min(1).max(20),
  })
  .strict();

export function assembleSearchAuthoringProducts(
  dependencies: ProductAuthoringDependencies,
): SearchAuthoringProductsOperation {
  return async (input) => {
    const parsed = parseCommand(querySchema, input);
    if (!parsed.ok) return failure({ code: "forbidden" });
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      parsed.value.actor,
    );
    if (!authorization.ok) return failure(authorization.error);

    const { limit, query } = parsed.value;
    try {
      const rows = await dependencies.prisma.product.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { archivedAt: true, id: true, name: true },
        take: limit,
        where: {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { slug: { contains: query, mode: "insensitive" } },
          ],
        },
      });
      return {
        ok: true,
        value: rows.map((row) => ({
          id: row.id,
          name: row.name,
          archived: row.archivedAt !== null,
        })),
      };
    } catch (error) {
      return failure(
        dependencyFailure(
          { module: "products", operation: "searchAuthoringProducts" },
          error,
          mapPostgresReadError(error),
        ),
      );
    }
  };
}
