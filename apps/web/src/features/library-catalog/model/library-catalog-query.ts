import { infiniteQueryOptions, type InfiniteData } from "@tanstack/react-query";

import type { LibraryCatalogPage } from "./library-view";
import {
  librarySearchQueryIdentity,
  type LibrarySearchQuery,
} from "./library-search-query";

export function libraryCatalogQueryKey(query: LibrarySearchQuery) {
  return [
    "library",
    "catalog",
    librarySearchQueryIdentity({ ...query, after: null }),
  ] as const;
}

type LibraryCatalogQueryKey = ReturnType<typeof libraryCatalogQueryKey>;
type LibraryCatalogPageParam = string | undefined;

export type LoadLibraryCatalogPage = (input: {
  readonly after: string | undefined;
  readonly signal: AbortSignal;
}) => Promise<LibraryCatalogPage>;

export type LibraryCatalogQueryOptions = ReturnType<
  typeof createLibraryCatalogQueryOptions
>;

export function createLibraryCatalogQueryOptions(
  loadPage: LoadLibraryCatalogPage,
  query: LibrarySearchQuery,
) {
  return infiniteQueryOptions<
    LibraryCatalogPage,
    Error,
    InfiniteData<LibraryCatalogPage, LibraryCatalogPageParam>,
    LibraryCatalogQueryKey,
    LibraryCatalogPageParam
  >({
    queryKey: libraryCatalogQueryKey(query),
    queryFn: ({ pageParam, signal }) => loadPage({ after: pageParam, signal }),
    initialPageParam: undefined as LibraryCatalogPageParam,
    getNextPageParam: (lastPage) =>
      lastPage.kind === "ready" ? lastPage.nextCursor ?? undefined : undefined,
  });
}
