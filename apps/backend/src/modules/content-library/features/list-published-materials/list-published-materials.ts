import { createHash } from "node:crypto";

import { z } from "zod";

import type { ContentAccess } from "../../../content-access/index.js";
import type {
  PublishedMaterialProjectionCursor,
  PublishedMaterialReader,
} from "../../../materials/index.js";
import { projectPublishedCatalogItems } from "../../shared/project-published-catalog-items.js";
import type {
  ListPublishedMaterialsQuery,
  PublishedMaterialCatalogResult,
} from "./list-published-materials.contract.js";

const facetSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);
const facetSlugsSchema = z.array(facetSlugSchema).max(20);
const querySchema = z
  .object({
    subject: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("anonymous") }).strict(),
      z
        .object({ kind: z.literal("account"), accountId: z.uuid() })
        .strict(),
    ]),
    after: z.string().min(1).max(512).optional(),
    canonicalTopicSlug: facetSlugSchema.optional(),
    formatSlugs: facetSlugsSchema.optional(),
    first: z.number().int().min(1).max(24),
    q: z.string().max(120).optional(),
    seriesSlugs: facetSlugsSchema.optional(),
    sort: z.enum(["newest", "relevance", "series", "title"]).optional(),
    topicSlugs: facetSlugsSchema.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (
      query.canonicalTopicSlug !== undefined &&
      (query.topicSlugs?.length ?? 0) > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Canonical Topic scope cannot be combined with Topic filters",
        path: ["topicSlugs"],
      });
    }
    if (
      query.sort === "series" &&
      new Set(query.seriesSlugs ?? []).size !== 1
    ) {
      context.addIssue({
        code: "custom",
        message: "Series order requires exactly one Series filter",
        path: ["sort"],
      });
    }
  });

const legacyCursorSchema = z
  .object({
    v: z.literal(1),
    materialId: z.uuid(),
    publishedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const projectionCursorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("newest"),
      materialId: z.uuid(),
      publishedAt: z.iso.datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("relevance"),
      materialId: z.uuid(),
      publishedAt: z.iso.datetime({ offset: true }),
      rank: z.number().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("series"),
      materialId: z.uuid(),
      ordinal: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("title"),
      materialId: z.uuid(),
      title: z.string().min(1).max(160),
    })
    .strict(),
]);

const cursorSchema = z
  .object({
    v: z.literal(2),
    fingerprint: z.string().length(43),
    cursor: projectionCursorSchema,
  })
  .strict();

export async function listPublishedMaterials(
  publishedMaterialReader: Pick<PublishedMaterialReader, "listProjections">,
  contentAccess: Pick<ContentAccess, "checkAvailabilityMany">,
  query: ListPublishedMaterialsQuery,
): Promise<PublishedMaterialCatalogResult> {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_request_shape" } };
  }

  const normalized = normalizeQuery(parsed.data);
  const fingerprint = queryFingerprint(normalized);
  const after =
    parsed.data.after === undefined
      ? undefined
      : decodeCursor(
          parsed.data.after,
          fingerprint,
          isDefaultQuery(normalized),
        );
  if (parsed.data.after !== undefined && after === undefined) {
    return { ok: false, error: { code: "invalid_request_shape" } };
  }

  const page = await publishedMaterialReader.listProjections({
    ...(normalized.canonicalTopicSlug === undefined
      ? {}
      : { canonicalTopicSlug: normalized.canonicalTopicSlug }),
    first: parsed.data.first,
    formatSlugs: normalized.formatSlugs,
    seriesSlugs: normalized.seriesSlugs,
    sort: normalized.sort,
    topicSlugs: normalized.topicSlugs,
    ...(normalized.q === undefined ? {} : { q: normalized.q }),
    ...(after === undefined ? {} : { after }),
  });
  if (!page.ok) {
    return page;
  }

  const projected = await projectPublishedCatalogItems(
    contentAccess,
    query.subject,
    page.value.items,
  );
  if (!projected.ok) {
    return projected;
  }
  return {
    ok: true,
    value: {
      facets: page.value.facets,
      items: projected.items,
      nextCursor:
        page.value.hasNext && page.value.continuation !== null
          ? encodeCursor(page.value.continuation, fingerprint)
          : null,
      totalCount: page.value.totalCount,
    },
  };
}

interface NormalizedCatalogQuery {
  readonly canonicalTopicSlug: string | undefined;
  readonly formatSlugs: readonly string[];
  readonly q: string | undefined;
  readonly seriesSlugs: readonly string[];
  readonly sort: "newest" | "relevance" | "series" | "title";
  readonly topicSlugs: readonly string[];
}

function normalizeQuery(
  query: z.infer<typeof querySchema>,
): NormalizedCatalogQuery {
  const q = query.q?.trim().replace(/\s+/gu, " ");
  const seriesSlugs = uniqueSorted(query.seriesSlugs ?? []);
  return {
    canonicalTopicSlug: query.canonicalTopicSlug,
    formatSlugs: uniqueSorted(query.formatSlugs ?? []),
    q: q === undefined || q.length === 0 ? undefined : q,
    seriesSlugs,
    sort:
      query.sort ??
      (q === undefined || q.length === 0
        ? seriesSlugs.length === 1
          ? "series"
          : "newest"
        : "relevance"),
    topicSlugs: uniqueSorted(query.topicSlugs ?? []),
  };
}

function decodeCursor(
  value: string,
  fingerprint: string,
  acceptLegacy: boolean,
): PublishedMaterialProjectionCursor | undefined {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    const current = cursorSchema.safeParse(decoded);
    if (current.success) {
      return current.data.fingerprint === fingerprint
        ? current.data.cursor
        : undefined;
    }
    const legacy = legacyCursorSchema.safeParse(decoded);
    return legacy.success && acceptLegacy
      ? {
          kind: "newest",
          materialId: legacy.data.materialId,
          publishedAt: legacy.data.publishedAt,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function encodeCursor(
  cursor: PublishedMaterialProjectionCursor,
  fingerprint: string,
): string {
  return Buffer.from(
    JSON.stringify({
      v: 2,
      fingerprint,
      cursor,
    }),
    "utf8",
  ).toString("base64url");
}
function queryFingerprint(query: NormalizedCatalogQuery): string {
  return createHash("sha256")
    .update(JSON.stringify(query))
    .digest("base64url");
}

function isDefaultQuery(query: NormalizedCatalogQuery): boolean {
  return (
    query.q === undefined &&
    query.canonicalTopicSlug === undefined &&
    query.formatSlugs.length === 0 &&
    query.seriesSlugs.length === 0 &&
    query.sort === "newest" &&
    query.topicSlugs.length === 0
  );
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
