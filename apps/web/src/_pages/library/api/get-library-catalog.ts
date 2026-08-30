import "server-only";

import { z } from "zod";

import type {
  LibraryCatalogPage,
  LibraryMaterialPreview,
} from "@/_pages/library/model/library-view";
import {
  hasActiveLibrarySearch,
  type LibrarySearchQuery,
} from "@/_pages/library/model/library-search-query";
import {
  BackendConnectionError,
  requestPublishedMaterialCatalog,
} from "@/shared/api/backend/index.server";
import { dependencyUnavailableProblemSchema } from "@/shared/api/problem-details";

const projectionSchema = z
  .object({
    materialId: z.string(),
    contentVersion: z.number().int().positive(),
    slug: z.string(),
    title: z.string(),
    summary: z.string(),
    access: z.enum(["free", "membership"]),
    availability: z.enum(["available", "locked", "unavailable"]),
    publishedAt: z.iso.datetime({ offset: true }),
    topic: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
    format: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
    tags: z.array(z.object({ id: z.string(), name: z.string() })),
    seriesMemberships: z.array(
      z.object({
        ordinal: z.number().int().positive(),
        series: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
      }),
    ),
  })
  .strict();

const catalogFacetSchema = z
  .object({
    count: z.number().int().nonnegative(),
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  })
  .strict();

const catalogSchema = z
  .object({
    facets: z
      .object({
        formats: z.array(catalogFacetSchema),
        series: z.array(catalogFacetSchema),
        topics: z.array(catalogFacetSchema),
      })
      .strict(),
    items: z.array(projectionSchema),
    nextCursor: z.string().min(1).max(512).nullable(),
    totalCount: z.number().int().nonnegative(),
  })
  .strict();

const invalidRequestProblemSchema = z
  .object({
    type: z.literal("urn:inside:problem:invalid-request-shape"),
    title: z.literal("Invalid request shape"),
    status: z.literal(400),
    code: z.literal("invalid_request_shape"),
  })
  .strict();

export class LibraryQueryRejectedError extends Error {
  constructor() {
    super("Content Library rejected the canonical query state");
    this.name = "LibraryQueryRejectedError";
  }
}

export async function getLibraryCatalogPage(
  query: LibrarySearchQuery,
  after: string | undefined,
  accessToken?: string,
  signal?: AbortSignal,
): Promise<LibraryCatalogPage> {
  let result: Awaited<ReturnType<typeof requestPublishedMaterialCatalog>>;
  try {
    result = await requestPublishedMaterialCatalog(toBackendQuery(query, after), {
      ...(accessToken === undefined ? {} : { accessToken }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return { kind: "unavailable" };
    }
    throw error;
  }

  if (!result.ok) {
    if (dependencyUnavailableProblemSchema.safeParse(result.problem).success) {
      return { kind: "unavailable" };
    }
    if (invalidRequestProblemSchema.safeParse(result.problem).success) {
      throw new LibraryQueryRejectedError();
    }
    throw new BackendConnectionError(
      "backend-error",
      `Content Library request returned ${String(result.response.status)}`,
    );
  }

  const parsed = catalogSchema.safeParse(result.body);
  if (!parsed.success) {
    throw new BackendConnectionError(
      "invalid-response",
      "Content Library response does not match the contract",
      { cause: parsed.error },
    );
  }
  if (parsed.data.items.length === 0) {
    return after === undefined && !hasActiveLibrarySearch(query)
      ? { kind: "empty" }
      : {
          facets: parsed.data.facets,
          kind: "ready",
          items: [],
          nextCursor: null,
          totalCount: parsed.data.totalCount,
        };
  }
  return {
    facets: parsed.data.facets,
    kind: "ready",
    items: parsed.data.items.map(toMaterialPreview),
    nextCursor: parsed.data.nextCursor,
    totalCount: parsed.data.totalCount,
  };
}

function toBackendQuery(
  query: LibrarySearchQuery,
  after: string | undefined,
) {
  return {
    format: query.formatSlugs,
    series: query.seriesSlugs,
    sort: query.sort,
    topic: query.topicSlugs,
    ...(after === undefined ? {} : { after }),
    ...(query.q.length === 0 ? {} : { q: query.q }),
  };
}

function toMaterialPreview(
  projection: z.infer<typeof projectionSchema>,
): LibraryMaterialPreview {
  return {
    slug: projection.slug,
    title: projection.title,
    summary: projection.summary,
    access: projection.access,
    availability: projection.availability,
    topic: projection.topic.name,
    format: projection.format.name,
    tags: projection.tags.map(({ name }) => name),
    seriesMemberships: projection.seriesMemberships.map(({ ordinal, series }) => ({
      ordinal,
      name: series.name,
    })),
  };
}
