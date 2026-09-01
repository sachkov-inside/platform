import "server-only";

import { z } from "zod";

import type { LibraryCatalogPage } from "@/_pages/library/model/library-view";
import {
  publishedMaterialProjectionSchema,
  toMaterialPreview,
} from "@/entities/material";
import {
  hasActiveLibrarySearch,
  type LibrarySearchQuery,
} from "@/_pages/library/model/library-search-query";
import {
  BackendConnectionError,
  requestPublishedMaterialCatalog,
} from "@/shared/api/backend/index.server";
import { dependencyUnavailableProblemSchema } from "@/shared/api/problem-details";

const catalogFacetSchema = z
  .object({
    count: z.number().int().nonnegative(),
    id: z.string(),
    name: z.string(),
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
