"use client";

import { DatabaseZap, RefreshCw } from "lucide-react";
import Link from "next/link";

import {
  CatalogControls,
  MaterialCatalogGrid,
  formatFoundMaterialCount,
  parseLibrarySearchParams,
  type LibraryCatalogPage,
  type LibrarySearchQuery,
} from "@/features/library-catalog";
import {
  PlaylistCard,
  TopicCard,
  formatMaterialCount,
} from "@/features/library-discovery";
import { Button } from "@/shared/ui/button";

export function LibraryPage({
  catalog,
  isRefreshing = false,
  onQueryChange,
  onRetry,
  query,
  result,
}: {
  readonly catalog?: React.ReactNode;
  readonly isRefreshing?: boolean;
  readonly onQueryChange: (query: LibrarySearchQuery) => void;
  readonly onRetry?: () => void;
  readonly query: LibrarySearchQuery;
  readonly result: LibraryCatalogPage;
}) {
  const facets =
    result.kind === "ready"
      ? result.facets
      : { formats: [], series: [], topics: [] };
  return (
    <div
      aria-busy={isRefreshing}
      className="@container/library -mx-5 -mb-7 overflow-hidden bg-background sm:-mx-8 sm:-mb-10 md:m-0 md:overflow-visible md:bg-transparent"
    >
      <LibraryHeader />
      <div className="px-5 pb-7 sm:px-8 sm:pb-10 md:px-0 md:pb-0">
        {result.kind === "ready" ? (
          <LibraryCollections facets={result.facets} />
        ) : null}
        <CatalogControls
          facets={facets}
          isRefreshing={isRefreshing}
          onQueryChange={onQueryChange}
          query={query}
          resetQuery={emptyLibraryQuery()}
        />
        {result.kind === "ready"
          ? result.totalCount === 0
            ? <LibraryNoResults
                onReset={() => {
                  onQueryChange(emptyLibraryQuery());
                }}
              />
            : catalog ?? (
                <LibraryCatalog
                  items={result.items}
                  totalCount={result.totalCount}
                />
              )
          : null}
        {result.kind === "empty" ? <LibraryEmpty /> : null}
        {result.kind === "unavailable" ? (
          <LibraryUnavailable
            {...(onRetry === undefined ? {} : { onRetry })}
          />
        ) : null}
      </div>
    </div>
  );
}

export function LibraryLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="База знаний загружается"
      className="@container/library -mx-5 -mb-7 overflow-hidden bg-background sm:-mx-8 sm:-mb-10 md:m-0 md:overflow-visible md:bg-transparent"
      data-library-state="loading"
    >
      <LibraryHeader />
      <div className="px-5 pb-7 sm:px-8 sm:pb-10 md:px-0 md:pb-0">
        <section aria-labelledby="library-loading-heading" className="mt-8 sm:mt-10">
          <h2 className="text-lg font-semibold tracking-[-0.025em]" id="library-loading-heading">
            Материалы
          </h2>
          <ul
            aria-hidden="true"
            className="mt-4 grid grid-cols-1 items-start justify-items-center gap-4 @min-[40rem]/library:grid-cols-2 @min-[68rem]/library:grid-cols-3"
            role="list"
          >
            {[0, 1, 2].map((item) => (
              <li className="w-full max-w-[28rem]" key={item}>
                <div className="h-52 animate-pulse rounded-xl bg-muted shadow-card motion-reduce:animate-none" />
              </li>
            ))}
          </ul>
          <p className="sr-only">Загружаем опубликованные материалы</p>
        </section>
      </div>
    </div>
  );
}

export function LibraryUnexpectedError({
  onRetry,
}: {
  readonly onRetry: () => void;
}) {
  return (
    <div className="@container/library -mx-5 -mb-7 overflow-hidden bg-background sm:-mx-8 sm:-mb-10 md:m-0 md:overflow-visible md:bg-transparent">
      <LibraryHeader />
      <div className="px-5 pb-7 sm:px-8 sm:pb-10 md:px-0 md:pb-0">
        <LibraryStatus
          action={
            <div className="flex flex-wrap gap-3">
              <Button onClick={onRetry} size="lg">
                <RefreshCw aria-hidden="true" />
                Повторить
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/library">Открыть первую страницу</Link>
              </Button>
            </div>
          }
          message="Не удалось загрузить каталог. Попробуйте ещё раз."
          state="unexpected-error"
          title="База знаний сейчас недоступна"
        />
      </div>
    </div>
  );
}

function LibraryHeader() {
  return (
    <header className="rounded-b-2xl bg-card px-5 pb-5 pt-4 sm:px-8 sm:pb-8 sm:pt-10 md:rounded-none md:bg-transparent md:p-0">
      <h1 className="text-balance text-2xl font-semibold leading-7 tracking-[-0.03em] @min-[30rem]/library:text-3xl @min-[30rem]/library:leading-9 @min-[52rem]/library:text-5xl @min-[52rem]/library:leading-[1.1]">
        База знаний
      </h1>
      <p className="mt-3 max-w-[58ch] text-pretty text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
        Темы, плейлисты и материалы Sachkov Inside.
      </p>
    </header>
  );
}

function LibraryCollections({
  facets,
}: {
  readonly facets: Extract<LibraryCatalogPage, { readonly kind: "ready" }>["facets"];
}) {
  return (
    <>
      <section aria-labelledby="topics-heading" className="mt-8 sm:mt-10">
        <h2 className="text-xl font-semibold tracking-[-0.025em] sm:text-2xl" id="topics-heading">
          Темы
        </h2>
        {facets.topics.length === 0 ? (
          <CollectionEmpty label="Тем пока нет" />
        ) : (
          <div className="mt-4 grid gap-4 @min-[42rem]/library:grid-cols-2 @min-[64rem]/library:grid-cols-3">
            {facets.topics.map((topic) => (
              <TopicCard
                key={topic.slug}
                topic={{
                  count: topic.count,
                  name: topic.name,
                  slug: topic.slug,
                  summary: topic.summary ?? "",
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="playlists-heading" className="mt-10 sm:mt-12">
        <h2 className="text-xl font-semibold tracking-[-0.025em] sm:text-2xl" id="playlists-heading">
          Плейлисты
        </h2>
        {facets.series.length === 0 ? (
          <CollectionEmpty label="Плейлистов пока нет" />
        ) : (
          <div className="@container/playlist-surface mt-4 grid gap-4 @min-[48rem]/library:grid-cols-2">
            {facets.series.map((playlist) => (
              <PlaylistCard
                key={playlist.slug}
                playlist={{
                  countLabel: formatMaterialCount(playlist.count),
                  name: playlist.name,
                  slug: playlist.slug,
                  summary: playlist.summary ?? "",
                }}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function CollectionEmpty({ label }: { readonly label: string }) {
  return (
    <div className="mt-4 rounded-2xl bg-muted px-5 py-7 sm:px-8">
      <p className="font-semibold">{label}</p>
    </div>
  );
}

export function LibraryCatalog({
  items,
  totalCount,
}: {
  readonly items: Extract<LibraryCatalogPage, { readonly kind: "ready" }>["items"];
  readonly totalCount: number;
}) {
  return (
    <section aria-labelledby="materials-heading" className="mt-8 sm:mt-10" data-library-state="ready">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.025em] @min-[30rem]/library:text-xl" id="materials-heading">
            Материалы
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatFoundMaterialCount(totalCount)}
          </p>
        </div>
      </div>
      <MaterialCatalogGrid className="mt-4" items={items} />
    </section>
  );
}

function LibraryNoResults({ onReset }: { readonly onReset: () => void }) {
  return (
    <section
      aria-labelledby="library-no-results-heading"
      className="mt-8 rounded-xl bg-muted px-5 py-8 text-center sm:mt-10"
      data-library-state="no-results"
    >
      <h2 className="text-xl font-semibold" id="library-no-results-heading">
        Ничего не найдено
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Измените запрос или сбросьте фильтры.
      </p>
      <Button
        className="mt-5 min-h-11 px-4"
        onClick={onReset}
        type="button"
        variant="outline"
      >
        Показать все материалы
      </Button>
    </section>
  );
}

function emptyLibraryQuery(): LibrarySearchQuery {
  return parseLibrarySearchParams(new URLSearchParams()).query;
}

function LibraryEmpty() {
  return (
    <LibraryStatus
      action={
        <Button asChild size="lg" variant="outline">
          <Link href="/map">Открыть Карту</Link>
        </Button>
      }
      state="empty"
      title="Опубликованных материалов пока нет"
    />
  );
}

function LibraryUnavailable({ onRetry }: { readonly onRetry?: () => void }) {
  return (
    <LibraryStatus
      action={
        onRetry === undefined ? (
          <Button asChild size="lg">
            <Link href="/library">
              <RefreshCw aria-hidden="true" />
              Повторить
            </Link>
          </Button>
        ) : (
          <Button onClick={onRetry} size="lg">
            <RefreshCw aria-hidden="true" />
            Повторить
          </Button>
        )
      }
      message="Каталог не отвечает. Попробуйте ещё раз через несколько минут."
      state="unavailable"
      title="База знаний временно недоступна"
    />
  );
}

function LibraryStatus({
  action,
  message,
  state,
  title,
}: {
  readonly action: React.ReactNode;
  readonly message?: string;
  readonly state: string;
  readonly title: string;
}) {
  return (
    <section className="mt-8 max-w-[48rem] sm:mt-10" data-library-state={state}>
      <div className="relative isolate overflow-clip rounded-2xl bg-secondary px-6 py-7 shadow-card sm:px-8 sm:py-9">
        <span
          aria-hidden="true"
          className="reader-status-halo absolute -right-10 -top-16 size-48 rounded-full bg-accent/15"
        />
        <span className="relative grid size-12 place-items-center rounded-xl bg-background/80 text-accent [&_svg]:size-6">
          <DatabaseZap aria-hidden="true" />
        </span>
        <h2 className="relative mt-5 max-w-[20ch] text-balance text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
          {title}
        </h2>
        {message === undefined ? null : (
          <p className="relative mt-4 max-w-[60ch] text-pretty leading-7 text-muted-foreground">
            {message}
          </p>
        )}
        <div className="relative mt-7">{action}</div>
      </div>
    </section>
  );
}
