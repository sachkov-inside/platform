"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { libraryCatalogBrowserQueryOptions } from "../api/library-catalog-query.browser";
import type { LibraryCatalogQueryOptions } from "../model/library-catalog-query";
import type { LibraryCatalogPage } from "../model/library-view";
import type { LibrarySearchQuery } from "../model/library-search-query";
import {
  LibraryLoading,
  LibraryPage,
  LibraryUnexpectedError,
} from "./library-page";
import { VirtualizedLibraryCatalog } from "./virtualized-library-catalog.client";

export function LibraryPageQuery({
  query,
  viewerScope,
}: {
  readonly query: LibrarySearchQuery;
  readonly viewerScope: string;
}) {
  return (
    <LibraryCatalogQueryView
      query={query}
      queryOptions={libraryCatalogBrowserQueryOptions(viewerScope, query)}
    />
  );
}

export function LibraryCatalogQueryView({
  query: searchQuery,
  queryOptions,
}: {
  readonly query: LibrarySearchQuery;
  readonly queryOptions: LibraryCatalogQueryOptions;
}) {
  const query = useInfiniteQuery(queryOptions);

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
        <VirtualizedLibraryCatalog
          hasNextPage={query.hasNextPage}
          isFetchNextPageError={query.isFetchNextPageError}
          isFetchingNextPage={query.isFetchingNextPage}
          onLoadNextPage={() => {
            void query.fetchNextPage();
          }}
          pages={readyPages}
          totalCount={firstPage.totalCount}
        />
      }
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
