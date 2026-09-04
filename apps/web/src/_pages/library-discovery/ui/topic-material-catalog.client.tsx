"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useMemo } from "react";

import {
  CatalogControls,
  InfiniteMaterialCatalog,
  parseLibrarySearchParams,
  topicLibraryCatalogQueryOptions,
  type LibrarySearchQuery,
  useLibraryCatalogQuery,
  withoutLibraryCursor,
} from "@/features/library-catalog";
import { materialReaderOriginHref } from "@/shared/routing/material-reader";
import { Button } from "@/shared/ui/button";

export function TopicMaterialCatalog({
  topicSlug,
}: {
  readonly topicSlug: string;
}) {
  const fixedQuery = useMemo(() => topicQuery(topicSlug), [topicSlug]);
  const createQueryOptions = useCallback(
    (query: LibrarySearchQuery) =>
      topicLibraryCatalogQueryOptions(topicSlug, query),
    [topicSlug],
  );
  const catalog = useLibraryCatalogQuery({
    createQueryOptions,
    initialQuery: fixedQuery,
  });

  const firstPage = catalog.firstPage;
  const facets =
    firstPage?.kind === "ready"
      ? firstPage.facets
      : { formats: [], series: [], topics: [] };

  return (
    <div className="@container/library mt-10">
      <CatalogControls
        facets={facets}
        hiddenFacets={["topic"]}
        isRefreshing={
          catalog.query.isFetching && !catalog.query.isFetchingNextPage
        }
        onQueryChange={(next) => {
          catalog.setSearchQuery(withoutLibraryCursor(next));
        }}
        query={catalog.searchQuery}
        resetQuery={fixedQuery}
      />
      {catalog.query.isPending ? (
        <CatalogStatus message="Загружаем материалы темы…" />
      ) : catalog.query.isError && catalog.query.data === undefined ? (
        <CatalogError onRetry={() => void catalog.query.refetch()} />
      ) : firstPage === undefined || firstPage.kind === "unavailable" ? (
        <CatalogError onRetry={() => void catalog.query.refetch()} />
      ) : firstPage.kind === "empty" ? (
        <CatalogEmpty />
      ) : firstPage.totalCount === 0 ? (
        <CatalogNoResults
          onReset={() => {
            catalog.setSearchQuery(fixedQuery);
          }}
        />
      ) : (
        <InfiniteMaterialCatalog
          hasNextPage={catalog.query.hasNextPage}
          isFetchNextPageError={catalog.query.isFetchNextPageError}
          isFetchingNextPage={catalog.query.isFetchingNextPage}
          onLoadNextPage={catalog.loadNextPage}
          pages={catalog.readyPages}
          returnHref={materialReaderOriginHref("topic", topicSlug)}
          totalCount={firstPage.totalCount}
        />
      )}
    </div>
  );
}

function topicQuery(topicSlug: string): LibrarySearchQuery {
  void topicSlug;
  return parseLibrarySearchParams(new URLSearchParams()).query;
}

function CatalogStatus({ message }: { readonly message: string }) {
  return (
    <p aria-live="polite" className="mt-8 rounded-2xl bg-muted px-5 py-8 text-sm text-muted-foreground">
      {message}
    </p>
  );
}

function CatalogEmpty() {
  return (
    <section
      className="mt-8 rounded-2xl bg-muted px-5 py-8 text-center"
      data-library-state="empty"
    >
      <h2 className="text-lg font-semibold">В теме пока нет материалов</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Опубликованные материалы появятся здесь после назначения темы.
      </p>
    </section>
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
