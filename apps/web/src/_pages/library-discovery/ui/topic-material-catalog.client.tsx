"use client";

import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CatalogControls,
  InfiniteMaterialCatalog,
  libraryCatalogQueryOptions,
  parseLibrarySearchParams,
  type LibraryCatalogPage,
  type LibrarySearchQuery,
} from "@/features/library-catalog";
import { Button } from "@/shared/ui/button";

const SEARCH_DEBOUNCE_MS = 250;

export function TopicMaterialCatalog({
  topicSlug,
}: {
  readonly topicSlug: string;
}) {
  const fixedQuery = useMemo(() => topicQuery(topicSlug), [topicSlug]);
  const [searchQuery, setSearchQuery] = useState(fixedQuery);
  const debouncedSearch = useDebouncedValue(searchQuery.q, SEARCH_DEBOUNCE_MS);
  const requestQuery = useMemo(
    () => ({ ...searchQuery, after: null, q: debouncedSearch }),
    [debouncedSearch, searchQuery],
  );
  const query = useInfiniteQuery({
    ...libraryCatalogQueryOptions(requestQuery),
    enabled: typeof window !== "undefined",
    placeholderData: keepPreviousData,
  });
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const loadNextPage = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const firstPage = query.data?.pages[0];
  const facets =
    firstPage?.kind === "ready"
      ? firstPage.facets
      : { formats: [], series: [], topics: [] };
  const readyPages = query.data?.pages.filter(isReadyPage) ?? [];

  return (
    <div className="@container/library mt-10">
      <CatalogControls
        facets={facets}
        hiddenFacets={["topic"]}
        isRefreshing={query.isFetching && !query.isFetchingNextPage}
        onQueryChange={(next) => {
          setSearchQuery({ ...next, after: null, topicSlugs: [topicSlug] });
        }}
        query={searchQuery}
        resetQuery={fixedQuery}
      />
      {query.isPending ? (
        <CatalogStatus message="Загружаем материалы темы…" />
      ) : query.isError && query.data === undefined ? (
        <CatalogError onRetry={() => void query.refetch()} />
      ) : firstPage === undefined || firstPage.kind === "unavailable" ? (
        <CatalogError onRetry={() => void query.refetch()} />
      ) : firstPage.kind === "empty" || firstPage.totalCount === 0 ? (
        <CatalogNoResults
          onReset={() => {
            setSearchQuery(fixedQuery);
          }}
        />
      ) : (
        <InfiniteMaterialCatalog
          hasNextPage={query.hasNextPage}
          isFetchNextPageError={query.isFetchNextPageError}
          isFetchingNextPage={query.isFetchingNextPage}
          onLoadNextPage={loadNextPage}
          pages={readyPages}
          totalCount={firstPage.totalCount}
        />
      )}
    </div>
  );
}

function topicQuery(topicSlug: string): LibrarySearchQuery {
  const search = new URLSearchParams();
  search.set("topic", topicSlug);
  return parseLibrarySearchParams(search).query;
}

function isReadyPage(
  page: LibraryCatalogPage,
): page is Extract<LibraryCatalogPage, { readonly kind: "ready" }> {
  return page.kind === "ready";
}

function CatalogStatus({ message }: { readonly message: string }) {
  return (
    <p aria-live="polite" className="mt-8 rounded-2xl bg-muted px-5 py-8 text-sm text-muted-foreground">
      {message}
    </p>
  );
}

function CatalogError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div className="mt-8 rounded-2xl bg-muted px-5 py-8">
      <p className="font-semibold">Не удалось загрузить материалы темы.</p>
      <Button className="mt-4" onClick={onRetry} size="sm" variant="outline">
        <RefreshCw aria-hidden="true" />
        Повторить
      </Button>
    </div>
  );
}

function CatalogNoResults({ onReset }: { readonly onReset: () => void }) {
  return (
    <section className="mt-8 rounded-2xl bg-muted px-5 py-8 text-center" data-library-state="no-results">
      <h2 className="text-lg font-semibold">Ничего не найдено</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Измените запрос или сбросьте фильтры.
      </p>
      <Button className="mt-4" onClick={onReset} type="button" variant="outline">
        Показать все материалы темы
      </Button>
    </section>
  );
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
