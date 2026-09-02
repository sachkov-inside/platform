import { z } from "zod";

import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { failure } from "../../shared/application-result.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type { ListAuthoringReferencesOperation } from "./list-authoring-references.contract.js";

const querySchema = z.object({ actor: accountId }).strict();

export function assembleListAuthoringReferences(
  dependencies: MaterialAuthoringDependencies,
): ListAuthoringReferencesOperation {
  return async (input) => {
    const parsed = parseCommand(querySchema, input);
    if (!parsed.ok) {
      return failure({ code: "forbidden" });
    }
    const authorization = await authorizeManager(
      dependencies.authorPolicy,
      parsed.value.actor,
    );
    if (!authorization.ok) {
      return failure(authorization.error);
    }

    try {
      const [formats, series, tags, topics] = await Promise.all([
        dependencies.prisma.format.findMany({
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: { id: true, name: true },
        }),
        dependencies.prisma.series.findMany({
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: { archivedAt: true, id: true, name: true },
        }),
        dependencies.prisma.tag.findMany({
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: { id: true, name: true },
        }),
        dependencies.prisma.topic.findMany({
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: { archivedAt: true, id: true, name: true },
        }),
      ]);
      return {
        ok: true,
        value: {
          formats: formats.map((item) => ({ ...item, archived: false })),
          series: series.map(({ archivedAt, ...item }) => ({
            ...item,
            archived: archivedAt !== null,
          })),
          tags: tags.map((item) => ({ ...item, archived: false })),
          topics: topics.map(({ archivedAt, ...item }) => ({
            ...item,
            archived: archivedAt !== null,
          })),
        },
      };
    } catch (error) {
      return failure(mapPostgresReadError(error));
    }
  };
}
