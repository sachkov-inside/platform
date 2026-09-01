"use client";

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { libraryCatalogQueryOptions } from "../api/library-catalog.browser";
import type { LibraryCatalogQueryOptions } from "../model/library-catalog-query";
import type { LibraryCatalogPage } from "../model/library-view";
import {
  parseLibrarySearchParams,
  serializeLibrarySearchQuery,
  type LibrarySearchQuery,
} from "../model/library-search-query";
import { InfiniteLibraryCatalog } from "./infinite-library-catalog.client";
import {
  LibraryLoading,
  LibraryPage,
  LibraryUnexpectedError,
} from "./library-page";

const SEARCH_DEBOUNCE_MS = 250;

export function LibraryPageQuery() {
  const locationSearch = useSyncExternalStore(
    subscribeToInitialLocation,
    readLocationSearch,
    readServerLocationSearch,
  );
  const initialQuery = useMemo(
    () =>
      locationSearch === null
        ? null
        : withoutCursor(
            parseLibrarySearchParams(new URLSearchParams(locationSearch)).query,
          ),
    [locationSearch],
  );

  if (initialQuery === null) {
    return <LibraryLoading />;
  }

  return (
    <LibraryCatalogQueryView
      createQueryOptions={libraryCatalogQueryOptions}
      initialQuery={initialQuery}
    />
  );
}

function subscribeToInitialLocation(): () => void {
  return () => undefined;
}

function readLocationSearch(): string | null {
  return window.location.search;
}

function readServerLocationSearch(): null {
  return null;
}

export function LibraryCatalogQueryView({
  createQueryOptions,
  initialQuery,
}: {
  readonly createQueryOptions: (
    query: LibrarySearchQuery,
  ) => LibraryCatalogQueryOptions;
  readonly initialQuery: LibrarySearchQuery;
}) {
  const [searchQuery, setSearchQuery] = useState(() =>
    withoutCursor(initialQuery),
  );
  const debouncedSearch = useDebouncedValue(searchQuery.q, SEARCH_DEBOUNCE_MS);
  const requestQuery = useMemo(
    () => withoutCursor({ ...searchQuery, q: debouncedSearch }),
    [debouncedSearch, searchQuery],
  );
  const query = useInfiniteQuery({
    ...createQueryOptions(requestQuery),
    enabled: typeof window !== "undefined",
    placeholderData: keepPreviousData,
  });
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  useEffect(() => {
    replaceLibraryUrl(requestQuery);
  }, [requestQuery]);

  useEffect(() => {
    const restoreUrlQuery = () => {
      setSearchQuery(
        withoutCursor(
          parseLibrarySearchParams(new URLSearchParams(window.location.search))
            .query,
        ),
      );
    };
    window.addEventListener("popstate", restoreUrlQuery);
    return () => {
      window.removeEventListener("popstate", restoreUrlQuery);
    };
  }, []);

  const changeQuery = useCallback((nextQuery: LibrarySearchQuery) => {
    setSearchQuery(withoutCursor(nextQuery));
  }, []);
  const loadNextPage = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) {
      return;
    }
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  if (query.isPending) {
    return <LibraryLoading />;
  }
  if (query.isError && query.data === undefined) {
    return <LibraryUnexpectedError onRetry={() => void query.refetch()} />;
  }

  const firstPage = query.data.pages[0];
  if (firstPage === undefined) {
    return <LibraryUnexpectedError onRetry={() => void query.refetch()} />;
  }
  if (firstPage.kind !== "ready") {
    return (
      <LibraryPage
        isRefreshing={query.isFetching}
        onQueryChange={changeQuery}
        onRetry={() => {
          void query.refetch();
        }}
        query={searchQuery}
        result={firstPage}
      />
    );
  }

  const readyPages = query.data.pages.filter(isReadyPage);
  const items = readyPages.flatMap((page) => page.items);

  return (
    <LibraryPage
      catalog={
        <InfiniteLibraryCatalog
          hasNextPage={query.hasNextPage}
          isFetchNextPageError={query.isFetchNextPageError}
          isFetchingNextPage={query.isFetchingNextPage}
          onLoadNextPage={loadNextPage}
          pages={readyPages}
          totalCount={firstPage.totalCount}
        />
      }
      isRefreshing={query.isFetching && !query.isFetchingNextPage}
      onQueryChange={changeQuery}
      query={searchQuery}
      result={{
        facets: firstPage.facets,
        kind: "ready",
        items,
        nextCursor: readyPages.at(-1)?.nextCursor ?? null,
        totalCount: firstPage.totalCount,
      }}
    />
  );
}

type ReadyLibraryCatalogPage = Extract<
  LibraryCatalogPage,
  { readonly kind: "ready" }
>;

function isReadyPage(
  page: LibraryCatalogPage,
): page is ReadyLibraryCatalogPage {
  return page.kind === "ready";
}

function withoutCursor(query: LibrarySearchQuery): LibrarySearchQuery {
  return { ...query, after: null };
}

function replaceLibraryUrl(query: LibrarySearchQuery): void {
  const search = serializeLibrarySearchQuery(withoutCursor(query));
  const href = search.length === 0 ? "/library" : `/library?${search}`;
  if (`${window.location.pathname}${window.location.search}` !== href) {
    window.history.replaceState(null, "", href);
  }
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
