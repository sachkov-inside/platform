import { z } from "zod";

import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import { selectPublishedMaterialProjectionPage } from "../../infrastructure/postgres/published-material-reader/published-material-projection.js";
import { normalizedUuidSchema } from "../../domain/uuid.js";
import { mapPostgresReadError } from "../../shared/postgres-error-mapping.js";
import type {
  ListPublishedMaterialProjectionsQuery,
  PublishedMaterialProjectionListResult,
} from "./list-published-material-projections.contract.js";

const facetSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);
const facetSlugsSchema = z
  .array(facetSlugSchema)
  .max(20)
  .transform((values) => [...new Set(values)].sort());
const cursorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("newest"),
      materialId: normalizedUuidSchema,
      publishedAt: z.iso.datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("relevance"),
      materialId: normalizedUuidSchema,
      publishedAt: z.iso.datetime({ offset: true }),
      rank: z.number().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("title"),
      materialId: normalizedUuidSchema,
      title: z.string().min(1).max(160),
    })
    .strict(),
]);
const querySchema = z
  .object({
    after: cursorSchema.optional(),
    formatSlugs: facetSlugsSchema.optional(),
    first: z.number().int().min(1).max(24),
    q: z
      .string()
      .trim()
      .max(120)
      .transform((value) => value.replace(/\s+/gu, " "))
      .optional(),
    seriesSlugs: facetSlugsSchema.optional(),
    sort: z.enum(["newest", "relevance", "title"]).optional(),
    topicSlugs: facetSlugsSchema.optional(),
  })
  .strict();

export async function listPublishedMaterialProjections(
  prisma: MaterialsPrisma,
  query: ListPublishedMaterialProjectionsQuery,
): Promise<PublishedMaterialProjectionListResult> {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_request_shape" } };
  }

  try {
    const page = await selectPublishedMaterialProjectionPage(prisma, {
      formatSlugs: parsed.data.formatSlugs ?? [],
      first: parsed.data.first,
      seriesSlugs: parsed.data.seriesSlugs ?? [],
      sort:
        parsed.data.sort ??
        (parsed.data.q === undefined || parsed.data.q.length === 0
          ? "newest"
          : "relevance"),
      topicSlugs: parsed.data.topicSlugs ?? [],
      ...(parsed.data.q === undefined || parsed.data.q.length === 0
        ? {}
        : { q: parsed.data.q }),
      ...(parsed.data.after === undefined
        ? {}
        : { after: parsed.data.after }),
    });
    return { ok: true, value: page };
  } catch (error) {
    return { ok: false, error: mapPostgresReadError(error) };
  }
}
