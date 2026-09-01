"use client";

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { LibraryCatalogPage } from "./library-view";
import type { LibraryCatalogQueryOptions } from "./library-catalog-query";
import {
  withoutLibraryCursor,
  type LibrarySearchQuery,
} from "./library-search-query";

const SEARCH_DEBOUNCE_MS = 250;

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
  const debouncedSearch = useDebouncedValue(
    searchQuery.q,
    SEARCH_DEBOUNCE_MS,
  );
  const requestQuery = useMemo(
    () =>
      withoutLibraryCursor({ ...searchQuery, q: debouncedSearch }),
    [debouncedSearch, searchQuery],
  );
  const query = useInfiniteQuery({
    ...createQueryOptions(requestQuery),
    enabled: typeof window !== "undefined",
    placeholderData: keepPreviousData,
  });
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const changeQuery = useCallback((nextQuery: LibrarySearchQuery) => {
    setSearchQuery(withoutLibraryCursor(nextQuery));
  }, []);
  const loadNextPage = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

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

function useDebouncedValue<Value>(value: Value, delay: number): Value {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [delay, value]);

  return debounced;
}
