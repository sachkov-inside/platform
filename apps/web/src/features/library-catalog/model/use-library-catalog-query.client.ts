"use client";

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { useLiveSearchValue } from "@/shared/lib/use-live-search-value.client";

import type { LibraryCatalogPage } from "./library-view";
import type { LibraryCatalogQueryOptions } from "./library-catalog-query";
import {
  libraryHref,
  parseLibrarySearchParams,
  withoutLibraryCursor,
  type LibrarySearchQuery,
} from "./library-search-query";

export function useLibraryCatalogQuery({
  createQueryOptions,
  initialQuery,
}: {
  readonly createQueryOptions: (
    query: LibrarySearchQuery,
  ) => LibraryCatalogQueryOptions;
  readonly initialQuery: LibrarySearchQuery;
}) {
  const [searchQuery, setSearchQuery] = useState(() =>
    withoutLibraryCursor(initialQuery),
  );
  const incomingHref = libraryHref(withoutLibraryCursor(initialQuery));
  const [previousIncomingHref, setPreviousIncomingHref] =
    useState(incomingHref);
  if (previousIncomingHref !== incomingHref) {
    setPreviousIncomingHref(incomingHref);
    const currentCanonical = parseLibrarySearchParams(
      new URL(libraryHref(searchQuery), "http://localhost").searchParams,
    ).query;
    if (libraryHref(currentCanonical) !== incomingHref)
      setSearchQuery(withoutLibraryCursor(initialQuery));
  }
  const debouncedSearch = useLiveSearchValue(searchQuery.q);
  const requestQuery = useMemo(
    () => withoutLibraryCursor({ ...searchQuery, q: debouncedSearch }),
    [debouncedSearch, searchQuery],
  );
  const query = useInfiniteQuery({
    ...createQueryOptions(requestQuery),
    enabled: typeof window !== "undefined",
    placeholderData: keepPreviousData,
  });
  const { fetchNextPage, hasNextPage, isFetching } = query;
  const changeQuery = useCallback((nextQuery: LibrarySearchQuery) => {
    setSearchQuery(withoutLibraryCursor(nextQuery));
  }, []);
  const loadNextPage = useCallback(() => {
    if (!hasNextPage || isFetching) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetching]);

  return {
    changeQuery,
    firstPage: query.data?.pages[0],
    loadNextPage,
    query,
    readyPages: query.data?.pages.filter(isReadyPage) ?? [],
    requestQuery,
    searchQuery,
    setSearchQuery,
  };
}

function isReadyPage(
  page: LibraryCatalogPage,
): page is Extract<LibraryCatalogPage, { readonly kind: "ready" }> {
  return page.kind === "ready";
}
