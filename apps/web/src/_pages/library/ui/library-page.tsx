import { DatabaseZap, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";

import type {
  LibraryCatalogFacet,
  LibraryCatalogPage,
} from "@/_pages/library/model/library-view";
import type { LibrarySearchQuery } from "@/_pages/library/model/library-search-query";
import { formatFoundMaterialCount } from "@/_pages/library/model/format-material-count";
import { MaterialCard } from "@/entities/material";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

export function LibraryPage({
  catalog,
  onRetry,
  query,
  result,
}: {
  readonly catalog?: React.ReactNode;
  readonly onRetry?: () => void;
  readonly query: LibrarySearchQuery;
  readonly result: LibraryCatalogPage;
}) {
  const facets =
    result.kind === "ready"
      ? result.facets
      : { formats: [], series: [], topics: [] };
  return (
    <div className="@container/library -mx-5 -mb-7 overflow-hidden bg-background sm:-mx-8 sm:-mb-10 md:m-0 md:overflow-visible md:bg-transparent">
      <LibraryHeader />
      <div className="px-5 pb-7 sm:px-8 sm:pb-10 md:px-0 md:pb-0">
        <LibrarySearchForm facets={facets} query={query} />
        {result.kind === "ready"
          ? result.totalCount === 0
            ? <LibraryNoResults />
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
      aria-label="Библиотека загружается"
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
          title="Библиотека сейчас недоступна"
        />
      </div>
    </div>
  );
}

function LibraryHeader() {
  return (
    <header className="rounded-b-2xl bg-card px-5 pb-5 pt-4 sm:px-8 sm:pb-8 sm:pt-10 md:rounded-none md:bg-transparent md:p-0">
      <h1 className="text-balance text-2xl font-semibold leading-7 tracking-[-0.03em] @min-[30rem]/library:text-3xl @min-[30rem]/library:leading-9 @min-[52rem]/library:text-5xl @min-[52rem]/library:leading-[1.1]">
        Библиотека
      </h1>
    </header>
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
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {formatFoundMaterialCount(totalCount)}
          </p>
        </div>
      </div>
      <LibraryMaterialGrid className="mt-4" items={items} />
    </section>
  );
}

function LibrarySearchForm({
  facets,
  query,
}: {
  readonly facets: {
    readonly formats: readonly LibraryCatalogFacet[];
    readonly series: readonly LibraryCatalogFacet[];
    readonly topics: readonly LibraryCatalogFacet[];
  };
  readonly query: LibrarySearchQuery;
}) {
  const activeFilterCount =
    query.topicSlugs.length +
    query.formatSlugs.length +
    query.seriesSlugs.length;

  return (
    <form action="/library" className="pt-4 sm:pt-6" method="get">
      <div className="grid gap-3 @min-[52rem]/library:grid-cols-[minmax(0,1fr)_12rem_auto] @min-[52rem]/library:items-end">
        <div>
          <label className="mb-2 block text-sm font-semibold" htmlFor="library-search">
            Поиск по библиотеке
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              className="min-h-12 w-full rounded-xl border border-input bg-card pl-10 pr-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
              defaultValue={query.q}
              id="library-search"
              maxLength={120}
              name="q"
              placeholder="Название, тема, тег"
              type="search"
            />
          </div>
        </div>
        <div>
          <span className="mb-2 block text-sm font-semibold" id="library-sort-label">
            Сортировка
          </span>
          <Select defaultValue={query.sort} name="sort">
            <SelectTrigger
              aria-labelledby="library-sort-label"
              className="min-h-12 w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="relevance">По релевантности</SelectItem>
              <SelectItem value="newest">Сначала новые</SelectItem>
              <SelectItem value="title">По названию</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button className="min-h-12 px-5" type="submit">
          Найти
        </Button>
      </div>

      {facets.topics.length + facets.formats.length + facets.series.length > 0 ? (
        <details className="mt-3 rounded-xl bg-muted/75 p-4" open>
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 font-semibold marker:content-none">
            <SlidersHorizontal aria-hidden="true" className="size-4" />
            Фильтры
            {activeFilterCount > 0 ? (
              <span className="grid size-6 place-items-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
                {activeFilterCount}
              </span>
            ) : null}
          </summary>
          <div className="mt-4 grid gap-5 @min-[44rem]/library:grid-cols-3 @min-[44rem]/library:gap-4">
            <LibraryFilterFieldset
              legend="Тема"
              name="topic"
              options={facets.topics}
              selected={query.topicSlugs}
            />
            <LibraryFilterFieldset
              legend="Формат"
              name="format"
              options={facets.formats}
              selected={query.formatSlugs}
            />
            <LibraryFilterFieldset
              legend="Серия"
              name="series"
              options={facets.series}
              selected={query.seriesSlugs}
            />
          </div>
        </details>
      ) : null}

      {query.q.length > 0 || activeFilterCount > 0 ? (
        <div className="mt-3 flex justify-end">
          <Button asChild className="min-h-11 px-4" variant="ghost">
            <Link href="/library">Сбросить поиск и фильтры</Link>
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function LibraryFilterFieldset({
  legend,
  name,
  options,
  selected,
}: {
  readonly legend: string;
  readonly name: "format" | "series" | "topic";
  readonly options: readonly LibraryCatalogFacet[];
  readonly selected: readonly string[];
}) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-2 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label className="cursor-pointer" key={option.id}>
            <input
              className="peer sr-only"
              defaultChecked={selected.includes(option.slug)}
              name={name}
              type="checkbox"
              value={option.slug}
            />
            <span className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:border-muted-foreground/45 hover:bg-muted/80 peer-checked:border-accent/55 peer-checked:bg-accent/12 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
              {option.name}
              <span className="font-mono text-[0.6875rem] text-muted-foreground">
                {option.count}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function LibraryNoResults() {
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
      <Button asChild className="mt-5 min-h-11 px-4" variant="outline">
        <Link href="/library">Показать все материалы</Link>
      </Button>
    </section>
  );
}

export function LibraryMaterialGrid({
  className = "",
  items,
  label,
}: {
  readonly className?: string;
  readonly items: Extract<LibraryCatalogPage, { readonly kind: "ready" }>["items"];
  readonly label?: string;
}) {
  return (
    <ul
      {...(label === undefined ? {} : { "aria-label": label })}
      className={`${className} grid grid-cols-1 items-start justify-items-center gap-4 @min-[40rem]/library:grid-cols-2 @min-[68rem]/library:grid-cols-3`}
      data-material-grid
      role="list"
    >
      {items.map((material) => (
        <li className="w-full max-w-[28rem]" key={material.slug}>
          <MaterialCard headingLevel="h3" material={material} />
        </li>
      ))}
    </ul>
  );
}

function LibraryEmpty() {
  return (
    <LibraryStatus
      action={
        <Button asChild size="lg" variant="outline">
          <Link href="/map">Открыть Карту</Link>
        </Button>
      }
      message="После публикации материалы появятся здесь автоматически."
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
      title="Библиотека временно недоступна"
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
  readonly message: string;
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
        <p className="relative mt-4 max-w-[60ch] text-pretty leading-7 text-muted-foreground">
          {message}
        </p>
        <div className="relative mt-7">{action}</div>
      </div>
    </section>
  );
}
