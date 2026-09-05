"use client";

import { Search, X } from "lucide-react";

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
  isRefreshing,
  onQueryChange,
  query,
  resetQuery,
  totalCount,
}: {
  readonly facets: {
    readonly formats: readonly LibraryCatalogFacet[];
    readonly series: readonly LibraryCatalogFacet[];
    readonly topics: readonly LibraryCatalogFacet[];
  };
  readonly isRefreshing: boolean;
  readonly onQueryChange: (query: LibrarySearchQuery) => void;
  readonly query: LibrarySearchQuery;
  readonly resetQuery: LibrarySearchQuery;
  readonly totalCount?: number;
}) {
  const activeFilterCount = query.formatSlugs.length;

  return (
    <form
      className="mt-7"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div>
        <label className="sr-only" htmlFor="library-search">
          Поиск по Базе знаний
        </label>
        <div className="relative flex min-h-14 items-center gap-3 rounded-2xl bg-muted px-4">
            <Search
              aria-hidden="true"
              className="size-5 shrink-0 text-muted-foreground"
            />
            <input
              className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
              id="library-search"
              maxLength={120}
              name="q"
              onChange={(event) => {
                onQueryChange(changeLibraryQuery(query, { q: event.currentTarget.value }));
              }}
              placeholder="Материал, серия, тема или тег"
              type="search"
              value={query.q}
            />
            {query.q.length > 0 ? (
              <button
                aria-label="Очистить поиск"
                className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-muted-foreground"
                onClick={() => {
                  onQueryChange(changeLibraryQuery(query, { q: "" }));
                }}
                type="button"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            ) : null}
        </div>
      </div>

      <div className="-mx-4 mt-5 overflow-hidden sm:mx-0">
        <div className="public-horizontal-rail flex items-center gap-2 overflow-x-auto px-4 sm:px-0">
          <CatalogFormatFieldset
            facets={facets.formats}
            onQueryChange={onQueryChange}
            query={query}
          />
        </div>
      </div>

      <div className="mt-4 flex min-h-10 items-center justify-between gap-3">
        <div className="min-w-0 shrink">
          <span className="sr-only" id="library-sort-label">
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
            <SelectTrigger
              aria-labelledby="library-sort-label"
              className="min-h-10 w-auto max-w-[10.5rem] rounded-full border-0 bg-muted px-4 text-sm font-semibold text-muted-foreground shadow-none"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="relevance">По релевантности</SelectItem>
              <SelectItem value="newest">Сначала новые</SelectItem>
              <SelectItem value="title">По названию</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-3 text-xs font-semibold text-muted-foreground">
          <p aria-live="polite">
            {isRefreshing
              ? "Обновляем…"
              : totalCount === undefined
                ? "Фильтры применены"
                : `Найдено: ${String(totalCount)}`}
          </p>
          {query.q.length > 0 || activeFilterCount > 0 ? (
            <Button
              className="h-auto min-h-0 shrink-0 p-0 text-xs font-semibold text-action hover:bg-transparent hover:text-action-hover"
              onClick={() => {
                onQueryChange(resetQuery);
              }}
              type="button"
              variant="ghost"
            >
              Сбросить всё
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function CatalogFormatFieldset({
  facets,
  onQueryChange,
  query,
}: {
  readonly facets: readonly LibraryCatalogFacet[];
  readonly onQueryChange: (query: LibrarySearchQuery) => void;
  readonly query: LibrarySearchQuery;
}) {
  const counts = new Map(facets.map((facet) => [facet.slug, facet.count]));
  const options = [
    { label: "Все форматы", slug: null },
    { label: "Гайды", slug: "guide" },
    { label: "Видео", slug: "video" },
    { label: "Заметки", slug: "note" },
  ] as const;
  return (
    <fieldset className="shrink-0 border-0 p-0">
      <legend className="sr-only">Формат</legend>
      <div className="flex gap-2">
        {options.map((option) => (
          <label className="cursor-pointer" key={option.slug ?? "all"}>
            <input
              checked={
                option.slug === null
                  ? query.formatSlugs.length === 0
                  : query.formatSlugs[0] === option.slug
              }
              className="peer sr-only"
              name="format"
              onChange={(event) => {
                if (!event.currentTarget.checked) return;
                onQueryChange(changeLibraryQuery(query, {
                  formatSlugs: option.slug === null ? [] : [option.slug],
                }));
              }}
              type="radio"
              value={option.slug ?? ""}
            />
            <span className="inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-muted px-4 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground peer-checked:bg-primary peer-checked:text-white peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
              {option.label}
              {option.slug !== null && counts.has(option.slug) ? (
                <span className="text-xs">
                  {counts.get(option.slug)}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
