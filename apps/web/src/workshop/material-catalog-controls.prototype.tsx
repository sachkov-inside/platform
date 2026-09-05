"use client";

import { ListFilter, Search, X } from "lucide-react";
import { useState } from "react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  LibraryFilters,
  type LibraryFilterOption,
} from "@/workshop/library-filters.prototype";
import type { MaterialPreviewFixture } from "@/workshop/material-preview.prototype";

export type MaterialSortOrder = "default" | "title" | "video-first";

export interface MaterialCatalogState {
  readonly query: string;
  readonly selectedFormats: readonly string[];
  readonly selectedSeriesIds: readonly string[];
  readonly selectedTopics: readonly string[];
  readonly sortOrder: MaterialSortOrder;
}

export interface MaterialCatalogControlsProps extends MaterialCatalogState {
  readonly idPrefix: string;
  readonly formatOptions: readonly string[];
  readonly seriesLabel?: string;
  readonly seriesOptions: readonly LibraryFilterOption[];
  readonly setQuery: (query: string) => void;
  readonly setSelectedFormats: (values: readonly string[]) => void;
  readonly setSelectedSeriesIds: (values: readonly string[]) => void;
  readonly setSelectedTopics?: (values: readonly string[]) => void;
  readonly setSortOrder: (sortOrder: MaterialSortOrder) => void;
  readonly topicOptions: readonly string[];
}

/** Shared Storybook controls for Material collections; production data stays behind adapters. */
export function MaterialCatalogControls({
  formatOptions,
  idPrefix,
  query,
  selectedFormats,
  selectedSeriesIds,
  selectedTopics,
  seriesLabel = "Серия",
  seriesOptions,
  setQuery,
  setSelectedFormats,
  setSelectedSeriesIds,
  setSelectedTopics,
  setSortOrder,
  sortOrder,
  topicOptions,
}: MaterialCatalogControlsProps) {
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const activeFilterCount =
    selectedFormats.length + selectedSeriesIds.length + selectedTopics.length;
  const filtersId = `${idPrefix}-filters`;
  const sortLabelId = `${idPrefix}-sort-label`;

  return (
    <div className="@container/material-controls mt-5">
      <div className="grid grid-cols-2 gap-2 @min-[40rem]/material-controls:grid-cols-[minmax(0,1fr)_auto_12rem]">
        <label className="relative col-span-2 block @min-[40rem]/material-controls:col-span-1">
          <span className="sr-only">Поиск по материалам</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            className={cn(
              "min-h-11 w-full rounded-xl border border-input bg-card pl-10 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
              query.length > 0 ? "pr-11" : "pr-3",
            )}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Название, тема или тег"
            type="search"
            value={query}
          />
          {query.length > 0 ? (
            <button
              aria-label="Очистить поиск"
              className="absolute right-0 top-0 grid size-11 place-items-center rounded-xl text-muted-foreground hover:text-foreground focus-visible:outline-ring"
              onClick={() => {
                setQuery("");
              }}
              type="button"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </label>

        <Button
          aria-controls={filtersId}
          aria-expanded={filtersExpanded}
          aria-label={
            activeFilterCount > 0
              ? `Фильтры, выбрано ${String(activeFilterCount)}`
              : "Фильтры"
          }
          className="min-h-11 justify-center bg-card px-4"
          onClick={() => {
            setFiltersExpanded((current) => !current);
          }}
          variant="outline"
        >
          <ListFilter aria-hidden="true" className="size-4" />
          Фильтры
          {activeFilterCount > 0 ? (
            <span className="ml-auto grid size-5 place-items-center rounded-full bg-accent text-[0.6875rem] font-bold text-accent-foreground">
              {activeFilterCount}
            </span>
          ) : null}
        </Button>

        <div className="min-w-0">
          <span className="sr-only" id={sortLabelId}>
            Сортировка
          </span>
          <Select
            onValueChange={(value) => {
              setSortOrder(value as MaterialSortOrder);
            }}
            value={sortOrder}
          >
            <SelectTrigger aria-labelledby={sortLabelId} className="min-h-11 bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="default">По умолчанию</SelectItem>
              <SelectItem value="video-first">Сначала видео</SelectItem>
              <SelectItem value="title">По названию</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {filtersExpanded ? (
        <div className="mt-2 rounded-xl bg-muted p-3" id={filtersId}>
          <LibraryFilters
            ariaLabel="Фильтры материалов"
            density="compact"
            formatOptions={formatOptions}
            selectedFormats={selectedFormats}
            selectedSeriesIds={selectedSeriesIds}
            selectedTopics={selectedTopics}
            seriesLabel={seriesLabel}
            seriesOptions={seriesOptions}
            setSelectedFormats={setSelectedFormats}
            setSelectedSeriesIds={setSelectedSeriesIds}
            setSelectedTopics={setSelectedTopics ?? ignoreSelection}
            topicOptions={topicOptions}
          />
        </div>
      ) : null}
    </div>
  );
}

export function applyMaterialCatalogState(
  materials: readonly MaterialPreviewFixture[],
  state: MaterialCatalogState,
): readonly MaterialPreviewFixture[] {
  const normalizedQuery = state.query.trim().toLocaleLowerCase("ru");
  const filtered = materials.filter((material) => {
    const searchableText = [
      material.title,
      material.summary,
      material.topic,
      material.format,
      ...material.tags,
      ...material.series.map((series) => series.title),
    ]
      .join(" ")
      .toLocaleLowerCase("ru");

    return (
      (normalizedQuery.length === 0 || searchableText.includes(normalizedQuery)) &&
      (state.selectedTopics.length === 0 ||
        state.selectedTopics.includes(material.topic)) &&
      (state.selectedFormats.length === 0 ||
        state.selectedFormats.includes(material.format)) &&
      (state.selectedSeriesIds.length === 0 ||
        material.series.some((series) => state.selectedSeriesIds.includes(series.id)))
    );
  });

  return filtered.toSorted((first, second) => {
    if (state.sortOrder === "title") {
      return first.title.localeCompare(second.title, "ru");
    }
    if (state.sortOrder === "video-first") {
      return Number(second.format === "Видео") - Number(first.format === "Видео");
    }
    return 0;
  });
}

function ignoreSelection(values: readonly string[]) {
  void values;
}
