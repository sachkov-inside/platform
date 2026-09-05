import "server-only";

import { z } from "zod";

import {
  hasActiveLibrarySearch,
  type LibraryCatalogPage,
  type LibrarySearchQuery,
} from "@/features/library-catalog";
import {
  publishedMaterialProjectionSchema,
  toMaterialPreview,
} from "@/entities/material.model";
import {
  BackendConnectionError,
  requestPublishedMaterialCatalog,
} from "@/shared/api/backend/index.server";
import { dependencyUnavailableProblemSchema } from "@/shared/api/problem-details";

const catalogFacetSchema = z
  .object({
    count: z.number().int().nonnegative(),
    cover: publishedMaterialProjectionSchema.shape.cover,
    id: z.string(),
    name: z.string(),
    previewItems: z.array(publishedMaterialProjectionSchema),
    slug: z.string(),
    summary: z.string().nullable(),
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
    items: z.array(publishedMaterialProjectionSchema),
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
  return requestLibraryCatalogPage(query, after, accessToken, signal);
}

export async function getTopicMaterialCatalogPage(
  topicSlug: string,
  query: LibrarySearchQuery,
  after: string | undefined,
  accessToken?: string,
  signal?: AbortSignal,
): Promise<LibraryCatalogPage> {
  return requestLibraryCatalogPage(
    query,
    after,
    accessToken,
    signal,
    topicSlug,
  );
}

async function requestLibraryCatalogPage(
  query: LibrarySearchQuery,
  after: string | undefined,
  accessToken?: string,
  signal?: AbortSignal,
  canonicalTopicSlug?: string,
): Promise<LibraryCatalogPage> {
  let result: Awaited<ReturnType<typeof requestPublishedMaterialCatalog>>;
  try {
    result = await requestPublishedMaterialCatalog(
      toBackendQuery(query, after, canonicalTopicSlug),
      {
        ...(accessToken === undefined ? {} : { accessToken }),
        ...(signal === undefined ? {} : { signal }),
      },
    );
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
          facets: mapFacets(parsed.data.facets),
          kind: "ready",
          items: [],
          nextCursor: null,
          totalCount: parsed.data.totalCount,
        };
  }
  return {
    facets: mapFacets(parsed.data.facets),
    kind: "ready",
    items: parsed.data.items.map(toMaterialPreview),
    nextCursor: parsed.data.nextCursor,
    totalCount: parsed.data.totalCount,
  };
}

function mapFacets(facets: z.infer<typeof catalogSchema>["facets"]) {
  return {
    formats: facets.formats.map(mapFacet),
    series: facets.series.map(mapFacet),
    topics: facets.topics.map(mapFacet),
  };
}

function mapFacet(facet: z.infer<typeof catalogFacetSchema>) {
  return {
    ...facet,
    previewItems: facet.previewItems.map(toMaterialPreview),
  };
}

function toBackendQuery(
  query: LibrarySearchQuery,
  after: string | undefined,
  canonicalTopicSlug?: string,
) {
  return {
    ...(canonicalTopicSlug === undefined
      ? {}
      : { canonicalTopic: canonicalTopicSlug }),
    format: query.formatSlugs,
    sort: query.sort,
    ...(after === undefined ? {} : { after }),
    ...(query.q.length === 0 ? {} : { q: query.q }),
  };
}
