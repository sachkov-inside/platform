"use client";

import { Button } from "@/shared/ui/button";
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
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState(defaultValue);
  const selected = value ?? selection;
  const matching = options.filter((option) =>
    option.label
      .toLocaleLowerCase("ru")
      .includes(search.trim().toLocaleLowerCase("ru")),
  );
  const lastPage = Math.max(0, Math.ceil(matching.length / 20) - 1);
  const currentPage = Math.min(page, lastPage);
  const shown = matching.slice(currentPage * 20, (currentPage + 1) * 20);
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
              setPage(0);
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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={currentPage === 0}
            aria-label={`Предыдущие варианты: ${label}`}
            onClick={() => {
              setPage(currentPage - 1);
            }}
          >
            Назад
          </Button>
          <span className="text-xs text-muted-foreground" role="status">
            {currentPage * 20 + 1}–
            {Math.min((currentPage + 1) * 20, matching.length)} из{" "}
            {matching.length}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={currentPage === lastPage}
            aria-label={`Следующие варианты: ${label}`}
            onClick={() => {
              setPage(currentPage + 1);
            }}
          >
            Далее
          </Button>
        </div>
      ) : null}
      {matching.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          По этому запросу ничего не найдено.
        </p>
      ) : null}
    </div>
  );
}
