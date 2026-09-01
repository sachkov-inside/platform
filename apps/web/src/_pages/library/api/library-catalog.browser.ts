import { z } from "zod";

import { materialPreviewSchema } from "@/entities/material";
import { createLibraryCatalogQueryOptions } from "../model/library-catalog-query";
import type { LibraryCatalogPage } from "../model/library-view";
import {
  serializeLibrarySearchQuery,
  type LibrarySearchQuery,
} from "../model/library-search-query";

const catalogFacetSchema = z
  .object({
    count: z.number().int().nonnegative(),
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  })
  .strict();

const libraryCatalogPageSchema: z.ZodType<LibraryCatalogPage> =
  z.discriminatedUnion("kind", [
    z
      .object({
        facets: z
          .object({
            formats: z.array(catalogFacetSchema),
            series: z.array(catalogFacetSchema),
            topics: z.array(catalogFacetSchema),
          })
          .strict(),
        kind: z.literal("ready"),
        items: z.array(materialPreviewSchema),
        nextCursor: z.string().min(1).max(512).nullable(),
        totalCount: z.number().int().nonnegative(),
      })
      .strict(),
    z.object({ kind: z.literal("empty") }).strict(),
    z.object({ kind: z.literal("unavailable") }).strict(),
  ]);

export class LibraryCatalogQueryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LibraryCatalogQueryError";
  }
}

/** Owns the browser-side catalog query, including cursor continuation through the same-origin BFF. */
export function libraryCatalogQueryOptions(query: LibrarySearchQuery) {
  return createLibraryCatalogQueryOptions(
    ({ after, signal }) => requestLibraryCatalogPage(query, after, signal),
    query,
  );
}

export async function requestLibraryCatalogPage(
  query: LibrarySearchQuery,
  after: string | undefined,
  signal: AbortSignal,
): Promise<LibraryCatalogPage> {
  const search = serializeLibrarySearchQuery({
    ...query,
    after: after ?? null,
  });
  const response = await fetch(
    search.length === 0
      ? "/api/library/materials"
      : `/api/library/materials?${search}`,
    {
      headers: { Accept: "application/json" },
      signal,
    },
  );

  if (!response.ok) {
    throw new LibraryCatalogQueryError(
      `Library query returned ${String(response.status)}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new LibraryCatalogQueryError(
      "Library query response is not valid JSON",
      { cause },
    );
  }

  const parsed = libraryCatalogPageSchema.safeParse(payload);
  if (!parsed.success) {
    throw new LibraryCatalogQueryError(
      "Library query response does not match the presentation contract",
      { cause: parsed.error },
    );
  }

  return parsed.data;
}
