"use client";

import { DatabaseZap, RefreshCw } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import {
  CatalogControls,
  MaterialCatalogGrid,
  formatFoundMaterialCount,
  libraryHref,
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
import { PublicSectionHeading } from "@/shared/ui/public-section-heading";
import { PublicProductHeader } from "@/widgets/application-shell";

export function LibraryPage({
  catalog,
  isRefreshing = false,
  onQueryChange,
  onRetry,
  query,
  returnHref,
  result,
}: {
  readonly catalog?: React.ReactNode;
  readonly isRefreshing?: boolean;
  readonly onQueryChange: (query: LibrarySearchQuery) => void;
  readonly onRetry?: () => void;
  readonly query: LibrarySearchQuery;
  readonly returnHref?: Route;
  readonly result: LibraryCatalogPage;
}) {
  const effectiveReturnHref = returnHref ?? libraryHref(query);
  const facets =
    result.kind === "ready"
      ? result.facets
      : { formats: [], series: [], topics: [] };
  return (
    <div
      aria-busy={isRefreshing}
      className="@container/library min-w-0"
    >
      <LibraryHeader />
      <div>
        <CatalogControls
          facets={facets}
          isRefreshing={isRefreshing}
          onQueryChange={onQueryChange}
          query={query}
          resetQuery={emptyLibraryQuery()}
          {...(result.kind === "ready" ? { totalCount: result.totalCount } : {})}
        />
        {result.kind === "ready" ? (
          <LibraryCollections
            facets={result.facets}
            returnHref={effectiveReturnHref}
          />
        ) : null}
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
                  returnHref={effectiveReturnHref}
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
      className="@container/library min-w-0"
      data-library-state="loading"
    >
      <LibraryHeader />
      <div>
        <section aria-labelledby="library-loading-heading" className="mt-11">
          <PublicSectionHeading id="library-loading-heading" title="Материалы" />
          <ul
            aria-hidden="true"
            className="mt-4 grid grid-cols-1 items-start gap-3 @min-[44rem]/library:grid-cols-2"
            role="list"
          >
            {[0, 1, 2].map((item) => (
              <li className="w-full" key={item}>
                <div className="h-28 animate-pulse rounded-2xl bg-[#f3f1ed] motion-reduce:animate-none" />
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
    <div className="@container/library min-w-0">
      <LibraryHeader />
      <div>
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
    <>
      <PublicProductHeader />
      <header className="mt-9 md:mt-12">
      <h1 className="text-[2.25rem] font-semibold leading-none tracking-[-0.055em] md:text-6xl">
        База знаний
      </h1>
      </header>
    </>
  );
}

function LibraryCollections({
  facets,
  returnHref,
}: {
  readonly facets: Extract<LibraryCatalogPage, { readonly kind: "ready" }>["facets"];
  readonly returnHref: Route;
}) {
  return (
    <>
      <section aria-labelledby="topics-heading">
        <CollectionHeading count={facets.topics.length} id="topics-heading" title="Темы" />
        {facets.topics.length === 0 ? (
          <CollectionEmpty label="Тем пока нет" />
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-7 @min-[48rem]/library:grid-cols-3 @min-[68rem]/library:grid-cols-4">
            {facets.topics.map((topic) => (
              <TopicCard
                key={topic.slug}
                returnHref={returnHref}
                topic={{
                  count: topic.count,
                  cover: topic.cover,
                  name: topic.name,
                  slug: topic.slug,
                  summary: topic.summary ?? "",
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="playlists-heading">
        <CollectionHeading count={facets.series.length} id="playlists-heading" title="Плейлисты" />
        {facets.series.length === 0 ? (
          <CollectionEmpty label="Плейлистов пока нет" />
        ) : (
          <div className="mt-4 grid gap-4 @min-[48rem]/library:grid-cols-2">
            {facets.series.map((playlist) => (
              <PlaylistCard
                key={playlist.slug}
                returnHref={returnHref}
                playlist={{
                  countLabel: formatMaterialCount(playlist.count),
                  cover: playlist.cover,
                  name: playlist.name,
                  previewItems: playlist.previewItems ?? [],
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

function CollectionHeading({
  count,
  id,
  title,
}: {
  readonly count: number;
  readonly id: string;
  readonly title: string;
}) {
  return (
    <PublicSectionHeading
      aside={
        <span className="text-sm font-semibold text-[#5f5e59]">{count}</span>
      }
      className="mt-11"
      id={id}
      title={title}
    />
  );
}

export function LibraryCatalog({
  items,
  returnHref = "/library",
  totalCount,
}: {
  readonly items: Extract<LibraryCatalogPage, { readonly kind: "ready" }>["items"];
  readonly returnHref?: Route;
  readonly totalCount: number;
}) {
  return (
    <section aria-labelledby="materials-heading" data-library-state="ready">
      <PublicSectionHeading
        aside={
          <p className="text-sm font-semibold text-[#5f5e59]">
            {formatFoundMaterialCount(totalCount)}
          </p>
        }
        className="mt-11"
        id="materials-heading"
        title="Материалы"
      />
      <MaterialCatalogGrid className="mt-4" items={items} returnHref={returnHref} />
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
        aria-label="Сбросить поиск и фильтры"
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
