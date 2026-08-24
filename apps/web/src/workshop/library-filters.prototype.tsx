"use client";

import { Check } from "lucide-react";

import { cn } from "@/shared/lib/utils";

export interface LibraryFilterOption {
  readonly label: string;
  readonly value: string;
}

export interface LibraryFiltersProps {
  readonly className?: string;
  readonly density?: "comfortable" | "compact";
  readonly formatOptions: readonly string[];
  readonly selectedFormats: readonly string[];
  readonly selectedSeriesIds: readonly string[];
  readonly selectedTopics: readonly string[];
  readonly seriesOptions: readonly LibraryFilterOption[];
  readonly setSelectedFormats: (values: readonly string[]) => void;
  readonly setSelectedSeriesIds: (values: readonly string[]) => void;
  readonly setSelectedTopics: (values: readonly string[]) => void;
  readonly topicOptions: readonly string[];
}

/** Canonical Library facets: Topic, Format and Series. */
export function LibraryFilters({
  className,
  density = "comfortable",
  formatOptions,
  selectedFormats,
  selectedSeriesIds,
  selectedTopics,
  seriesOptions,
  setSelectedFormats,
  setSelectedSeriesIds,
  setSelectedTopics,
  topicOptions,
}: LibraryFiltersProps) {
  const compact = density === "compact";

  return (
    <div className="@container/library-filters">
      <div
        aria-label="Фильтры библиотеки"
        className={cn(
          "grid gap-5",
          compact && "@min-[44rem]/library-filters:grid-cols-3 @min-[44rem]/library-filters:gap-4",
          className,
        )}
        role="region"
      >
        <FilterGroup
          compact={compact}
          legend="Тема"
          options={topicOptions.map(toFilterOption)}
          selected={selectedTopics}
          setSelected={setSelectedTopics}
        />
        <FilterGroup
          compact={compact}
          legend="Формат"
          options={formatOptions.map(toFilterOption)}
          selected={selectedFormats}
          setSelected={setSelectedFormats}
        />
        <FilterGroup
          compact={compact}
          legend="Серия"
          options={seriesOptions}
          selected={selectedSeriesIds}
          setSelected={setSelectedSeriesIds}
        />
      </div>
    </div>
  );
}

function FilterGroup({
  compact,
  legend,
  options,
  selected,
  setSelected,
}: {
  readonly compact: boolean;
  readonly legend: string;
  readonly options: readonly LibraryFilterOption[];
  readonly selected: readonly string[];
  readonly setSelected: (values: readonly string[]) => void;
}) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-2 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {legend}
      </legend>
      <div className={cn(compact ? "flex flex-wrap gap-1.5" : "grid gap-2")}>
        {options.map((option) => {
          const checked = selected.includes(option.value);

          return (
            <label
              className={cn(
                "cursor-pointer border font-medium transition-colors has-focus-visible:outline-3 has-focus-visible:outline-ring has-focus-visible:outline-offset-2",
                compact
                  ? "inline-flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-xs"
                  : "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm",
                checked
                  ? "border-accent/55 bg-accent/12 text-foreground shadow-sm"
                  : "border-border bg-card text-foreground hover:border-muted-foreground/45 hover:bg-muted/80",
              )}
              key={option.value}
            >
              <input
                checked={checked}
                className="peer sr-only"
                onChange={() => {
                  setSelected(toggleValue(selected, option.value));
                }}
                type="checkbox"
              />
              <SelectionMark checked={checked} compact={compact} />
              <span className="min-w-0 break-words">{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function SelectionMark({
  checked,
  compact,
}: {
  readonly checked: boolean;
  readonly compact: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-md border",
        compact ? "size-4" : "size-5",
        checked ? "border-accent bg-accent text-accent-foreground" : "border-input bg-background",
      )}
    >
      {checked ? <Check className={compact ? "size-3" : "size-3.5"} /> : null}
    </span>
  );
}

function toFilterOption(value: string): LibraryFilterOption {
  return { label: value, value };
}

function toggleValue(values: readonly string[], value: string): readonly string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
