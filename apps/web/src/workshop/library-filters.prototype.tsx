"use client";

import { Check, Search, X } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/shared/lib/utils";

export interface LibraryFiltersProps {
  readonly className?: string;
  readonly density?: "comfortable" | "compact";
  readonly formatOptions: readonly string[];
  readonly selectedFormats: readonly string[];
  readonly selectedTags: readonly string[];
  readonly setSelectedFormats: (values: readonly string[]) => void;
  readonly setSelectedTags: (values: readonly string[]) => void;
  readonly tagOptions: readonly string[];
}

/** Space-efficient library filters with searchable multi-select tags. */
export function LibraryFilters({
  className,
  density = "comfortable",
  formatOptions,
  selectedFormats,
  selectedTags,
  setSelectedFormats,
  setSelectedTags,
  tagOptions,
}: LibraryFiltersProps) {
  const compact = density === "compact";

  return (
    <div className="@container/library-filters">
      <div
        aria-label="Фильтры библиотеки"
        className={cn(
          "grid gap-5",
          compact &&
            "@min-[36rem]/library-filters:grid-cols-[minmax(10rem,0.55fr)_minmax(0,1.45fr)]",
          className,
        )}
        role="region"
      >
        <fieldset className="min-w-0 border-0 p-0">
        <legend className="mb-2 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Формат
        </legend>
        <div className={cn(compact ? "flex flex-wrap gap-1.5" : "grid gap-2")}>
          {formatOptions.map((option) => {
            const checked = selectedFormats.includes(option);

            return (
              <label
                className={cn(
                  "cursor-pointer font-medium has-focus-visible:outline-3 has-focus-visible:outline-ring has-focus-visible:outline-offset-2",
                  compact
                    ? "inline-flex min-h-9 items-center rounded-lg px-3 text-xs"
                    : "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm",
                  checked ? "bg-secondary text-foreground" : "bg-background text-muted-foreground",
                )}
                key={option}
              >
                <input
                  checked={checked}
                  className="peer sr-only"
                  onChange={() => {
                    setSelectedFormats(toggleValue(selectedFormats, option));
                  }}
                  type="checkbox"
                />
                {compact ? null : <SelectionMark checked={checked} />}
                <span className="min-w-0 break-words">{option}</span>
              </label>
            );
          })}
        </div>
        </fieldset>

        <TagPicker
          compact={compact}
          options={tagOptions}
          selected={selectedTags}
          setSelected={setSelectedTags}
        />
      </div>
    </div>
  );
}

export function TagPicker({
  compact = false,
  options,
  selected,
  setSelected,
}: {
  readonly compact?: boolean;
  readonly options: readonly string[];
  readonly selected: readonly string[];
  readonly setSelected: (values: readonly string[]) => void;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const matchingOptions = options
    .filter((option) => !selected.includes(option))
    .filter(
      (option) =>
        normalizedQuery.length === 0 || option.toLocaleLowerCase("ru").includes(normalizedQuery),
    )
    .slice(0, 3);

  return (
    <div className="min-w-0">
      <label
        className="mb-2 block font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
        htmlFor={inputId}
      >
        Теги
      </label>
      {selected.length > 0 ? (
        <ul aria-label="Выбранные теги" className="mb-2 flex flex-wrap gap-1.5" role="list">
          {selected.map((tag) => (
            <li key={tag}>
              <button
                aria-label={`Убрать тег: ${tag}`}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-secondary px-2.5 text-xs font-semibold text-secondary-foreground hover:bg-muted focus-visible:outline-ring"
                onClick={() => {
                  setSelected(selected.filter((item) => item !== tag));
                }}
                type="button"
              >
                {tag}
                <X aria-hidden="true" className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          className={cn(
            "w-full rounded-xl border border-input bg-background pl-9 pr-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
            compact ? "min-h-10" : "min-h-11",
          )}
          id={inputId}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Найти тег"
          type="search"
          value={query}
        />
      </div>
      <fieldset className="mt-2 border-0 p-0">
        <legend className="sr-only">Доступные теги</legend>
        {matchingOptions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {matchingOptions.map((option) => (
              <label
                className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-background px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground has-focus-visible:outline-3 has-focus-visible:outline-ring has-focus-visible:outline-offset-2"
                key={option}
              >
                <input
                  className="sr-only"
                  onChange={() => {
                    setSelected([...selected, option]);
                    setQuery("");
                  }}
                  type="checkbox"
                />
                <span aria-hidden="true" className="text-accent">+</span>
                {option}
              </label>
            ))}
          </div>
        ) : (
          <p className="px-1 py-1 text-xs text-muted-foreground" role="status">
            {selected.length === options.length ? "Все теги выбраны" : "Теги не найдены"}
          </p>
        )}
      </fieldset>
    </div>
  );
}

function SelectionMark({ checked }: { readonly checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-md border",
        checked ? "border-accent bg-accent text-accent-foreground" : "border-input bg-background",
      )}
    >
      {checked ? <Check className="size-3.5" /> : null}
    </span>
  );
}

function toggleValue(values: readonly string[], value: string): readonly string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
