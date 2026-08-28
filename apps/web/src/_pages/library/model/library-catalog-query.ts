import { infiniteQueryOptions } from "@tanstack/react-query";

import type { LibraryCatalogPage } from "./library-view";

export function libraryCatalogQueryKey(viewerScope: string) {
  return ["library", "catalog", viewerScope] as const;
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
) {
  return infiniteQueryOptions({
    queryKey: libraryCatalogQueryKey(viewerScope),
    queryFn: ({ pageParam, signal }) =>
      loadPage({ after: pageParam, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.kind === "ready"
        ? lastPage.nextCursor ?? undefined
        : undefined,
  });
}
