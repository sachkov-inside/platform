import { z } from "zod";

import type { MaterialAuthoringDependencies } from "../../facets/material-authoring/material-authoring.dependencies.js";
import { authorizeManager } from "../../ports/author-policy.js";
import { failure } from "../../shared/application-result.js";
import { accountId, parseCommand } from "../../shared/command-validation.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type {
  AuthoringMaterialListItemDto,
  ListMaterialsOperation,
} from "./list-materials.contract.js";

const publicationStateSchema = z.enum(["draft", "published", "unpublished"]);
const querySchema = z
  .object({
    actor: accountId,
    first: z.number().int().min(1).max(50),
    page: z.number().int().min(1).max(10_000),
    publicationState: publicationStateSchema.optional(),
    search: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .transform((value) => value.replace(/\s+/gu, " "))
      .optional(),
  })
  .strict();

export function assembleListMaterials(
  dependencies: MaterialAuthoringDependencies,
): ListMaterialsOperation {
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

    const { first, page, publicationState, search } = parsed.value;
    const where = {
      ...(publicationState === undefined ? {} : { publicationState }),
      ...(search === undefined
        ? {}
        : {
            OR: [
              { title: { contains: search, mode: "insensitive" as const } },
              { summary: { contains: search, mode: "insensitive" as const } },
              { slug: { contains: search, mode: "insensitive" as const } },
            ],
          }),
    };

    try {
      const value = await dependencies.prisma.$transaction(async (prisma) => {
        const [totalItems, rows] = await Promise.all([
          prisma.material.count({ where }),
          prisma.material.findMany({
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            select: {
              contentVersion: true,
              firstPublishedAt: true,
              formatId: true,
              id: true,
              publicationState: true,
              title: true,
              topicId: true,
              updatedAt: true,
            },
            skip: (page - 1) * first,
            take: first,
            where,
          }),
        ]);
        const topicIds = unique(rows.flatMap((row) => row.topicId ?? []));
        const formatIds = unique(rows.flatMap((row) => row.formatId ?? []));
        const [topics, formats] = await Promise.all([
          prisma.topic.findMany({
            select: { id: true, name: true },
            where: { id: { in: topicIds } },
          }),
          prisma.format.findMany({
            select: { id: true, name: true },
            where: { id: { in: formatIds } },
          }),
        ]);
        const topicById = new Map(topics.map((topic) => [topic.id, topic]));
        const formatById = new Map(formats.map((format) => [format.id, format]));

        return {
          items: rows.map((row): AuthoringMaterialListItemDto => ({
            canDelete:
              row.publicationState === "draft" &&
              row.firstPublishedAt === null,
            contentVersion: Number(row.contentVersion),
            format: row.formatId === null ? null : (formatById.get(row.formatId) ?? null),
            materialId: row.id,
            publicationState: publicationStateSchema.parse(row.publicationState),
            title: row.title,
            topic: row.topicId === null ? null : (topicById.get(row.topicId) ?? null),
            updatedAt: row.updatedAt.toISOString(),
          })),
          page,
          pageSize: first,
          totalItems,
          totalPages: Math.ceil(totalItems / first),
        };
      });
      return { ok: true, value };
    } catch (error) {
      return failure(mapPostgresReadError(error));
    }
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
