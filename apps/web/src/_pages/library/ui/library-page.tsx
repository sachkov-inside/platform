"use client";

import { ChevronDown, DatabaseZap, RefreshCw } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import {
  LibrarySearchControl,
  LibrarySearchPlaceholder,
  MaterialCatalogControls,
  MaterialCatalogGrid,
  changeLibraryQuery,
  formatFoundMaterialCount,
  libraryHref,
  parseLibrarySearchParams,
  type LibraryCatalogPage,
  type LibrarySearchQuery,
} from "@/features/library-catalog";
import {
  PlaylistCard,
  formatMaterialCount,
} from "@/features/library-discovery";
import { Button } from "@/shared/ui/button";
import { PublicSectionHeading } from "@/shared/ui/public-section-heading";
import { useLibrarySeriesExpansion } from "./library-series-state.client";

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
  return (
    <LibraryFrame busy={isRefreshing}>
      <LibrarySearchArea>
        <LibrarySearchControl
          onQueryChange={onQueryChange}
          query={query}
        />
      </LibrarySearchArea>
      {result.kind === "ready" ? (
        <LibrarySeries
          q={query.q}
          returnHref={effectiveReturnHref}
          series={result.facets.series}
        />
      ) : null}
      {result.kind === "ready" ? (
        <LibraryMaterials
          controls={
            <MaterialCatalogControls
              facets={result.facets}
              isRefreshing={isRefreshing}
              onQueryChange={onQueryChange}
              query={query}
              resetQuery={materialResetQuery(query)}
              totalCount={result.totalCount}
            />
          }
          totalCount={result.totalCount}
        >
          {result.totalCount === 0 ? (
            <LibraryNoResults
              hasMaterialFilters={hasMaterialFilters(query)}
              onClearFilters={() => {
                onQueryChange(materialResetQuery(query));
              }}
              onClearSearch={() => {
                onQueryChange(changeLibraryQuery(query, { q: "" }));
              }}
              q={query.q}
            />
          ) : catalog ?? (
            <LibraryCatalog
              items={result.items}
              returnHref={effectiveReturnHref}
            />
          )}
        </LibraryMaterials>
      ) : null}
      {result.kind === "empty" ? <LibraryEmpty /> : null}
      {result.kind === "unavailable" ? (
        <LibraryUnavailable
          {...(onRetry === undefined ? {} : { onRetry })}
        />
      ) : null}
    </LibraryFrame>
  );
}

/**
 * Первый экран Базы знаний, пока данные ещё идут. Оболочку, шапку и место поиска состояние берёт
 * оттуда же, откуда готовая страница, поэтому верх экрана не переезжает, когда страница оживает.
 *
 * Заголовка «Материалы» здесь намеренно нет. Готовая страница ставит между поиском и материалами
 * секцию руководств, а её высота зависит от данных, которых сейчас ещё нет: угадать место
 * заголовка невозможно. Собственный заголовок на неверном месте — такой же выдуманный элемент,
 * как неактивное поле поиска, и он же превращает поиск по имени заголовка в ловушку: проверка
 * замерила бы сначала копию, потом настоящий элемент. Поэтому здесь только серые блоки.
 */
export function LibraryLoading() {
  return (
    <LibraryFrame busy label="База знаний загружается" state="loading">
      <LibrarySearchArea />
      <div className="mt-11">
        <ul
          aria-hidden="true"
          className="grid grid-cols-1 items-start gap-3 @min-[44rem]/library:grid-cols-2"
          role="list"
        >
          {[0, 1, 2].map((item) => (
            <li className="w-full" key={item}>
              <div className="h-28 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
            </li>
          ))}
        </ul>
        <p className="sr-only">Загружаем опубликованные материалы</p>
      </div>
    </LibraryFrame>
  );
}

export function LibraryUnexpectedError({
  onRetry,
}: {
  readonly onRetry: () => void;
}) {
  return (
    <LibraryFrame>
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
    </LibraryFrame>
  );
}

/**
 * Каркас Базы знаний. Все состояния страницы берут оболочку и шапку отсюда: пока это делал каждый
 * сам, у загрузки не оказалось `overflow-x-clip`, и во время загрузки страница могла поехать вбок.
 */
function LibraryFrame({
  busy = false,
  children,
  label,
  state,
}: {
  readonly busy?: boolean;
  readonly children: React.ReactNode;
  readonly label?: string;
  readonly state?: "loading";
}) {
  return (
    <div
      aria-busy={busy || undefined}
      aria-label={label}
      className="@container/library min-w-0 overflow-x-clip"
      data-library-frame
      data-library-state={state}
    >
      <LibraryHeader />
      <div>{children}</div>
    </div>
  );
}

/** Место поиска над каталогом: одинаковое у готовой страницы и у загрузки. */
function LibrarySearchArea({ children }: { readonly children?: React.ReactNode }) {
  return <div className="mt-7" data-library-search>{children ?? <LibrarySearchPlaceholder />}</div>;
}

function LibraryHeader() {
  return (
    <>
      <header className="mt-9 md:mt-12">
        <h1 className="text-[2.25rem] font-semibold leading-none tracking-[-0.055em] md:text-6xl">
          База знаний
        </h1>
      </header>
    </>
  );
}

function LibrarySeries({
  q,
  returnHref,
  series,
}: {
  readonly q: string;
  readonly returnHref: Route;
  readonly series: Extract<
    LibraryCatalogPage,
    { readonly kind: "ready" }
  >["facets"]["series"];
}) {
  const { expanded, toggle } = useLibrarySeriesExpansion(q);
  const visibleSeries = expanded ? series : series.slice(0, 3);

  return (
    <section aria-labelledby="series-heading">
      <CollectionHeading
        count={series.length}
        id="series-heading"
        title="Руководства"
      />
      {series.length === 0 ? (
        <CollectionEmpty
          label={
            q.length === 0 ? "Руководств пока нет" : "Руководства по запросу не найдены"
          }
        />
      ) : (
        <div className="mt-4 grid gap-4 @min-[48rem]/library:grid-cols-2" id="library-series-list">
          {visibleSeries.map((playlist) => (
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
      {series.length > 3 ? (
        <div className="mt-5 flex justify-center">
          <Button
            aria-controls="library-series-list"
            aria-expanded={expanded}
            className="min-h-11 rounded-full px-4"
            onClick={toggle}
            type="button"
            variant="outline"
          >
            {expanded ? "Свернуть" : "Показать все"}
            <ChevronDown aria-hidden="true" className={expanded ? "rotate-180" : undefined} />
          </Button>
        </div>
      ) : null}
    </section>
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
        <span className="text-sm font-semibold text-muted-foreground">{count}</span>
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
}: {
  readonly items: Extract<LibraryCatalogPage, { readonly kind: "ready" }>["items"];
  readonly returnHref?: Route;
}) {
  return (
    <MaterialCatalogGrid className="mt-4" items={items} returnHref={returnHref} />
  );
}

function LibraryMaterials({
  children,
  controls,
  totalCount,
}: {
  readonly children: React.ReactNode;
  readonly controls: React.ReactNode;
  readonly totalCount: number;
}) {
  return (
    <section
      aria-labelledby="materials-heading"
      className="mt-11"
      data-library-state="ready"
    >
      <PublicSectionHeading
        aside={
          <p className="text-sm font-semibold text-muted-foreground">
            {formatFoundMaterialCount(totalCount)}
          </p>
        }
        id="materials-heading"
        title="Материалы"
      />
      {controls}
      {children}
    </section>
  );
}

function LibraryNoResults({
  hasMaterialFilters,
  onClearFilters,
  onClearSearch,
  q,
}: {
  readonly hasMaterialFilters: boolean;
  readonly onClearFilters: () => void;
  readonly onClearSearch: () => void;
  readonly q: string;
}) {
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
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {hasMaterialFilters ? (
          <Button onClick={onClearFilters} type="button" variant="outline">
            Сбросить фильтры материалов
          </Button>
        ) : null}
        {q.length > 0 ? (
          <Button onClick={onClearSearch} type="button" variant="outline">
            Очистить поиск
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function materialResetQuery(query: LibrarySearchQuery): LibrarySearchQuery {
  const defaults = parseLibrarySearchParams({ q: query.q }).query;
  return changeLibraryQuery(query, {
    formatSlugs: [],
    sort: defaults.sort,
    topicSlug: null,
  });
}

function hasMaterialFilters(query: LibrarySearchQuery): boolean {
  const reset = materialResetQuery(query);
  return query.formatSlugs.length > 0 || query.topicSlug !== null || query.sort !== reset.sort;
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
