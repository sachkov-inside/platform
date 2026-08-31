import { infiniteQueryOptions } from "@tanstack/react-query";

import type { LibraryCatalogPage } from "./library-view";
import {
  librarySearchQueryIdentity,
  type LibrarySearchQuery,
} from "./library-search-query";

export function libraryCatalogQueryKey(
  viewerScope: string,
  query: LibrarySearchQuery,
) {
  return [
    "library",
    "catalog",
    viewerScope,
    librarySearchQueryIdentity(query),
  ] as const;
}

export type LoadLibraryCatalogPage = (input: {
    readonly after: string | undefined;
    readonly signal: AbortSignal;
  }) => Promise<LibraryCatalogPage>;

export type LibraryCatalogQueryOptions = ReturnType<
  typeof createLibraryCatalogQueryOptions
>;

/** Owns the one cache identity and cursor protocol for the whole catalog. */
export function createLibraryCatalogQueryOptions(
  loadPage: LoadLibraryCatalogPage,
  viewerScope: string,
  query: LibrarySearchQuery,
) {
  return infiniteQueryOptions({
    queryKey: libraryCatalogQueryKey(viewerScope, query),
    queryFn: ({ pageParam, signal }) =>
      loadPage({ after: pageParam, signal }),
    initialPageParam: query.after ?? undefined,
    getNextPageParam: (lastPage) =>
      lastPage.kind === "ready"
        ? lastPage.nextCursor ?? undefined
        : undefined,
  });
}
