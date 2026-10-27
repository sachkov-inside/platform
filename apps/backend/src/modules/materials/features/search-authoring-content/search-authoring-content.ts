import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { failure } from "../../shared/application-result.js";
import {
  authoringMaterialSearchWhere,
  authoringSearchTextSchema,
} from "../../shared/authoring-material-search.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type {
  SearchAuthoringMaterialsOperation,
  SearchAuthoringProductsOperation,
} from "./search-authoring-content.contract.js";

const publicationStateSchema = z.enum(["draft", "published", "unpublished"]);
const querySchema = z
  .object({
    actor: accountId,
    query: authoringSearchTextSchema,
    limit: z.number().int().min(1).max(20),
  })
  .strict();

export function assembleSearchAuthoringProducts(
  dependencies: MaterialAuthoringDependencies,
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
          { module: "materials", operation: "searchAuthoringProducts" },
          error,
          mapPostgresReadError(error),
        ),
      );
    }
  };
}

export function assembleSearchAuthoringMaterials(
  dependencies: MaterialAuthoringDependencies,
): SearchAuthoringMaterialsOperation {
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
      const rows = await dependencies.prisma.material.findMany({
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          publicationState: true,
          title: true,
          topicId: true,
        },
        take: limit,
        where: authoringMaterialSearchWhere(query),
      });
      const topicIds = [...new Set(rows.flatMap((row) => row.topicId ?? []))];
      const topics =
        topicIds.length === 0
          ? []
          : await dependencies.prisma.topic.findMany({
              select: { id: true, name: true },
              where: { id: { in: topicIds } },
            });
      const topicName = new Map(topics.map((topic) => [topic.id, topic.name]));
      return {
        ok: true,
        value: rows.map((row) => ({
          id: row.id,
          title: row.title,
          publicationState: publicationStateSchema.parse(row.publicationState),
          topic:
            row.topicId === null ? null : (topicName.get(row.topicId) ?? null),
        })),
      };
    } catch (error) {
      return failure(
        dependencyFailure(
          { module: "materials", operation: "searchAuthoringMaterials" },
          error,
          mapPostgresReadError(error),
        ),
      );
    }
  };
}
