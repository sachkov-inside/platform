"use client";

import { Search, SlidersHorizontal } from "lucide-react";

import { materialTaxonomyLabel } from "@/entities/material";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import type { LibraryCatalogFacet } from "../model/library-view";
import {
  changeLibraryQuery,
  type LibraryCatalogSort,
  type LibrarySearchQuery,
} from "../model/library-search-query";

export function CatalogControls({
  facets,
  hiddenFacets = [],
  isRefreshing,
  onQueryChange,
  query,
  resetQuery,
}: {
  readonly facets: {
    readonly formats: readonly LibraryCatalogFacet[];
    readonly series: readonly LibraryCatalogFacet[];
    readonly topics: readonly LibraryCatalogFacet[];
  };
  readonly hiddenFacets?: readonly ("format" | "series" | "topic")[];
  readonly isRefreshing: boolean;
  readonly onQueryChange: (query: LibrarySearchQuery) => void;
  readonly query: LibrarySearchQuery;
  readonly resetQuery: LibrarySearchQuery;
}) {
  const visibleSelections = [
    ...(hiddenFacets.includes("topic") ? [] : query.topicSlugs),
    ...(hiddenFacets.includes("format") ? [] : query.formatSlugs),
    ...(hiddenFacets.includes("series") ? [] : query.seriesSlugs),
  ];
  const activeFilterCount = visibleSelections.length;
  const hasFacetOptions =
    (hiddenFacets.includes("topic") ? 0 : facets.topics.length) +
      (hiddenFacets.includes("format") ? 0 : facets.formats.length) +
      (hiddenFacets.includes("series") ? 0 : facets.series.length) >
    0;

  return (
    <form
      className="mt-12 border-t border-border pt-8 sm:mt-16 sm:pt-10"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div className="grid gap-3 @min-[52rem]/library:grid-cols-[minmax(0,1fr)_12rem] @min-[52rem]/library:items-end">
        <div>
          <label className="mb-2 block text-sm font-semibold" htmlFor="library-search">
            Поиск по базе знаний
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              className="min-h-12 w-full rounded-xl border border-input bg-card pl-10 pr-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
              id="library-search"
              maxLength={120}
              name="q"
              onChange={(event) => {
                onQueryChange(changeLibraryQuery(query, { q: event.currentTarget.value }));
              }}
              placeholder="Название, тема, тег"
              type="search"
              value={query.q}
            />
          </div>
        </div>
        <div>
          <span className="mb-2 block text-sm font-semibold" id="library-sort-label">
            Сортировка
          </span>
          <Select
            name="sort"
            onValueChange={(value) => {
              onQueryChange(
                changeLibraryQuery(query, { sort: value as LibraryCatalogSort }),
              );
            }}
            value={query.sort}
          >
            <SelectTrigger aria-labelledby="library-sort-label" className="min-h-12 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="relevance">По релевантности</SelectItem>
              <SelectItem value="newest">Сначала новые</SelectItem>
              {query.seriesSlugs.length === 1 ? (
                <SelectItem value="series">По порядку плейлиста</SelectItem>
              ) : null}
              <SelectItem value="title">По названию</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p aria-live="polite" className="mt-2 min-h-5 text-xs text-muted-foreground">
        {isRefreshing ? "Обновляем материалы…" : "Фильтры применяются сразу"}
      </p>

      {hasFacetOptions ? (
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
            {hiddenFacets.includes("topic") ? null : (
              <CatalogFilterFieldset
                legend="Тема"
                name="topic"
                onQueryChange={onQueryChange}
                options={facets.topics}
                query={query}
                selected={query.topicSlugs}
              />
            )}
            {hiddenFacets.includes("format") ? null : (
              <CatalogFilterFieldset
                legend="Формат"
                name="format"
                onQueryChange={onQueryChange}
                options={facets.formats}
                query={query}
                selected={query.formatSlugs}
              />
            )}
            {hiddenFacets.includes("series") ? null : (
              <CatalogFilterFieldset
                legend="Плейлисты"
                name="series"
                onQueryChange={onQueryChange}
                options={facets.series}
                query={query}
                selected={query.seriesSlugs}
              />
            )}
          </div>
        </details>
      ) : null}

      {query.q.length > 0 || activeFilterCount > 0 ? (
        <div className="mt-3 flex justify-end">
          <Button
            className="min-h-11 px-4"
            onClick={() => {
              onQueryChange(resetQuery);
            }}
            type="button"
            variant="ghost"
          >
            Сбросить поиск и фильтры
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function CatalogFilterFieldset({
  legend,
  name,
  onQueryChange,
  options,
  query,
  selected,
}: {
  readonly legend: string;
  readonly name: "format" | "series" | "topic";
  readonly onQueryChange: (query: LibrarySearchQuery) => void;
  readonly options: readonly LibraryCatalogFacet[];
  readonly query: LibrarySearchQuery;
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
              checked={selected.includes(option.slug)}
              className="peer sr-only"
              name={name}
              onChange={(event) => {
                const values = event.currentTarget.checked
                  ? [...selected, option.slug]
                  : selected.filter((slug) => slug !== option.slug);
                onQueryChange(
                  changeLibraryQuery(query, { [facetProperty(name)]: values }),
                );
              }}
              type="checkbox"
              value={option.slug}
            />
            <span className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:border-muted-foreground/45 hover:bg-muted/80 peer-checked:border-accent/55 peer-checked:bg-accent/12 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
              {name === "format" ? materialTaxonomyLabel(option.name) : option.name}
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

function facetProperty(
  name: "format" | "series" | "topic",
): "formatSlugs" | "seriesSlugs" | "topicSlugs" {
  if (name === "format") return "formatSlugs";
  if (name === "series") return "seriesSlugs";
  return "topicSlugs";
}
