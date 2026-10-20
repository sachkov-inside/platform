"use client";

import { useId, useState } from "react";

/** A complete owner list remains searchable without placing it all in the select DOM. */
export function AdminSearchSelect({
  label,
  name,
  options,
  defaultValue = "",
  value,
  onValueChange,
}: {
  readonly label: string;
  readonly name: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly defaultValue?: string;
  readonly value?: string;
  readonly onValueChange?: (value: string) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState(defaultValue);
  const selected = value ?? selection;
  const matching = options.filter((option) =>
    option.label
      .toLocaleLowerCase("ru")
      .includes(search.trim().toLocaleLowerCase("ru")),
  );
  const shown = matching.slice(0, 20);
  const chosen = options.find((option) => option.value === selected);
  const choices =
    chosen === undefined ||
    shown.some((option) => option.value === chosen.value)
      ? shown
      : [chosen, ...shown];

  return (
    <div className="grid min-w-0 gap-2">
      <label className="text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      {options.length > 20 ? (
        <label className="grid gap-1 text-sm text-muted-foreground">
          <span className="sr-only">Поиск: {label}</span>
          <input
            className="min-h-11 w-full rounded-lg border border-input bg-card px-3 text-sm"
            type="search"
            placeholder="Найти по названию"
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
          />
        </label>
      ) : null}
      <select
        className="min-h-11 w-full rounded-lg border border-input bg-card px-3 text-sm"
        id={id}
        name={name}
        value={chosen === undefined ? "" : selected}
        required
        onChange={(event) => {
          const next = event.currentTarget.value;
          setSelection(next);
          onValueChange?.(next);
        }}
      >
        <option value="" disabled>
          Выберите вариант
        </option>
        {choices.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {matching.length > shown.length ? (
        <p className="text-xs text-muted-foreground">
          Показаны первые 20. Уточните название, чтобы найти остальные.
        </p>
      ) : null}
      {matching.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          По этому запросу ничего не найдено.
        </p>
      ) : null}
    </div>
  );
}
