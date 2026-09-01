"use client";

import {
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

import {
  InfiniteMaterialCatalog,
  libraryCatalogQueryOptions,
  parseLibrarySearchParams,
  serializeLibrarySearchQuery,
  type LibraryCatalogQueryOptions,
  type LibrarySearchQuery,
  useLibraryCatalogQuery,
  withoutLibraryCursor,
} from "@/features/library-catalog";
import {
  LibraryLoading,
  LibraryPage,
  LibraryUnexpectedError,
} from "./library-page";

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
        : withoutLibraryCursor(
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
  const catalog = useLibraryCatalogQuery({
    createQueryOptions,
    initialQuery,
  });
  const { setSearchQuery } = catalog;

  useEffect(() => {
    replaceLibraryUrl(catalog.requestQuery);
  }, [catalog.requestQuery]);

  useEffect(() => {
    const restoreUrlQuery = () => {
      setSearchQuery(
        withoutLibraryCursor(
          parseLibrarySearchParams(new URLSearchParams(window.location.search))
            .query,
        ),
      );
    };
    window.addEventListener("popstate", restoreUrlQuery);
    return () => {
      window.removeEventListener("popstate", restoreUrlQuery);
    };
  }, [setSearchQuery]);

  if (catalog.query.isPending) {
    return <LibraryLoading />;
  }
  if (catalog.query.isError && catalog.query.data === undefined) {
    return (
      <LibraryUnexpectedError
        onRetry={() => void catalog.query.refetch()}
      />
    );
  }

  const firstPage = catalog.firstPage;
  if (firstPage === undefined) {
    return (
      <LibraryUnexpectedError
        onRetry={() => void catalog.query.refetch()}
      />
    );
  }
  if (firstPage.kind !== "ready") {
    return (
      <LibraryPage
        isRefreshing={catalog.query.isFetching}
        onQueryChange={catalog.changeQuery}
        onRetry={() => {
          void catalog.query.refetch();
        }}
        query={catalog.searchQuery}
        result={firstPage}
      />
    );
  }

  const items = catalog.readyPages.flatMap((page) => page.items);

  return (
    <LibraryPage
      catalog={
        <InfiniteMaterialCatalog
          hasNextPage={catalog.query.hasNextPage}
          isFetchNextPageError={catalog.query.isFetchNextPageError}
          isFetchingNextPage={catalog.query.isFetchingNextPage}
          onLoadNextPage={catalog.loadNextPage}
          pages={catalog.readyPages}
          totalCount={firstPage.totalCount}
        />
      }
      isRefreshing={
        catalog.query.isFetching && !catalog.query.isFetchingNextPage
      }
      onQueryChange={catalog.changeQuery}
      query={catalog.searchQuery}
      result={{
        facets: firstPage.facets,
        kind: "ready",
        items,
        nextCursor: catalog.readyPages.at(-1)?.nextCursor ?? null,
        totalCount: firstPage.totalCount,
      }}
    />
  );
}

function replaceLibraryUrl(query: LibrarySearchQuery): void {
  const search = serializeLibrarySearchQuery(withoutLibraryCursor(query));
  const href = search.length === 0 ? "/library" : `/library?${search}`;
  if (`${window.location.pathname}${window.location.search}` !== href) {
    window.history.replaceState(null, "", href);
  }
}
