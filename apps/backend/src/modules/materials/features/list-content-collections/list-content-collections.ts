import { z } from "zod";

import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { failure } from "../../shared/application-result.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type {
  ContentCollectionDto,
  ListContentCollectionsOperation,
} from "./list-content-collections.contract.js";

const querySchema = z
  .object({ actor: accountId, kind: z.enum(["series", "topic"]) })
  .strict();

export function assembleListContentCollections(
  dependencies: MaterialAuthoringDependencies,
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
        value:
          parsed.value.kind === "topic"
            ? await listTopics(dependencies)
            : await listSeries(dependencies),
      };
    } catch (error) {
      return failure(mapPostgresReadError(error));
    }
  };
}

async function listTopics(
  dependencies: MaterialAuthoringDependencies,
): Promise<readonly ContentCollectionDto[]> {
  const [collections, counts] = await Promise.all([
    dependencies.prisma.topic.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        archivedAt: true,
        id: true,
        name: true,
        slug: true,
        summary: true,
        version: true,
      },
    }),
    dependencies.prisma.material.groupBy({
      by: ["topicId"],
      where: { topicId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const countById = new Map(
    counts.flatMap(({ topicId, _count }) =>
      topicId === null ? [] : [[topicId, _count._all] as const],
    ),
  );
  return collections.map((collection) => ({
    archived: collection.archivedAt !== null,
    id: collection.id,
    kind: "topic",
    materialCount: countById.get(collection.id) ?? 0,
    name: collection.name,
    slug: collection.slug,
    summary: collection.summary,
    version: collection.version,
  }));
}

async function listSeries(
  dependencies: MaterialAuthoringDependencies,
): Promise<readonly ContentCollectionDto[]> {
  const [collections, counts] = await Promise.all([
    dependencies.prisma.series.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        archivedAt: true,
        id: true,
        name: true,
        slug: true,
        summary: true,
        version: true,
      },
    }),
    dependencies.prisma.seriesMembership.groupBy({
      by: ["seriesId"],
      _count: { _all: true },
    }),
  ]);
  const countById = new Map(
    counts.map(({ seriesId, _count }) => [seriesId, _count._all]),
  );
  return collections.map((collection) => ({
    archived: collection.archivedAt !== null,
    id: collection.id,
    kind: "series",
    materialCount: countById.get(collection.id) ?? 0,
    name: collection.name,
    slug: collection.slug,
    summary: collection.summary,
    version: collection.version,
  }));
}
