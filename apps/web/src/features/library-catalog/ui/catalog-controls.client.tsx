"use client";

import { Search } from "lucide-react";

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
  hiddenFacets: _hiddenFacets = [],
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
  const activeFilterCount = query.formatSlugs.length;

  return (
    <form
      className="mt-10 sm:mt-14"
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
              <SelectItem value="title">По названию</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p aria-live="polite" className="mt-2 min-h-5 text-xs text-muted-foreground">
        {isRefreshing ? "Обновляем материалы…" : "Фильтры применяются сразу"}
      </p>

      {facets.formats.length > 0 ? (
        <div className="mt-3">
          <CatalogFilterFieldset
            legend="Формат"
            onQueryChange={onQueryChange}
            options={facets.formats}
            query={query}
            selected={query.formatSlugs}
          />
        </div>
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
  onQueryChange,
  options,
  query,
  selected,
}: {
  readonly legend: string;
  readonly onQueryChange: (query: LibrarySearchQuery) => void;
  readonly options: readonly LibraryCatalogFacet[];
  readonly query: LibrarySearchQuery;
  readonly selected: readonly string[];
}) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-2 text-xs font-medium text-muted-foreground">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label className="cursor-pointer" key={option.id}>
            <input
              checked={selected.includes(option.slug)}
              className="peer sr-only"
              name="format"
              onChange={(event) => {
                const values = event.currentTarget.checked
                  ? [...selected, option.slug]
                  : selected.filter((slug) => slug !== option.slug);
                onQueryChange(
                  changeLibraryQuery(query, { formatSlugs: values }),
                );
              }}
              type="checkbox"
              value={option.slug}
            />
            <span className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:border-muted-foreground/45 hover:bg-muted/80 peer-checked:border-accent/55 peer-checked:bg-accent/12 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
              {materialTaxonomyLabel(option.name)}
              <span className="text-xs text-muted-foreground">
                {option.count}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
