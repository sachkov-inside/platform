"use client";

import { CircleAlert, X } from "lucide-react";
import { useId, useState } from "react";

import { hasText } from "@/shared/lib/text";
import { Button } from "@/shared/ui/button";

import "./admin.css";

export interface AdminChoice {
  readonly value: string;
  readonly label: string;
  /** Подстрока варианта: цена, состояние. */
  readonly detail?: string;
}

/** Сколько вариантов выбор показывает за раз; остальные доступны поиском и продолжением. */
export const adminChoicePageSize = 20;

function matches(choice: AdminChoice, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase("ru");
  return needle === "" || choice.label.toLocaleLowerCase("ru").includes(needle);
}

function SearchInput({
  label,
  value,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
}) {
  return (
    <label className="grid gap-1">
      <span className="sr-only">Поиск: {label}</span>
      <input
        autoComplete="off"
        className="admin-field-input max-w-none"
        disabled={disabled}
        enterKeyHint="search"
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
        placeholder="Найти по названию"
        type="search"
        value={value}
      />
    </label>
  );
}

function FieldError({
  id,
  children,
}: {
  readonly id: string;
  readonly children: string;
}) {
  return (
    <p className="admin-field-error" id={id}>
      <CircleAlert aria-hidden="true" />
      {children}
    </p>
  );
}

/**
 * Выбор одного варианта из полного списка владельца: поиск по названию и страницы по двадцать,
 * чтобы длинный список не попадал в разметку целиком. Выбранный вариант остаётся в списке и
 * тогда, когда поиск его не находит.
 */
export function AdminSearchSelect({
  label,
  name,
  options,
  value,
  onValueChange,
  placeholder = "Выберите вариант",
  disabled = false,
  hint,
  error,
}: {
  readonly label: string;
  readonly name?: string;
  readonly options: readonly AdminChoice[];
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly hint?: string;
  readonly error?: string;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const matching = options.filter((option) => matches(option, search));
  const lastPage = Math.max(
    0,
    Math.ceil(matching.length / adminChoicePageSize) - 1,
  );
  const currentPage = Math.min(page, lastPage);
  const shown = matching.slice(
    currentPage * adminChoicePageSize,
    (currentPage + 1) * adminChoicePageSize,
  );
  const chosen = options.find((option) => option.value === value);
  const choices =
    chosen === undefined || shown.some((option) => option.value === value)
      ? shown
      : [chosen, ...shown];
  const describedBy = [
    hasText(hint) ? `${id}-hint` : null,
    hasText(error) ? `${id}-error` : null,
  ]
    .filter((part) => part !== null)
    .join(" ");

  return (
    <div className="admin-field">
      <label className="admin-field-label" htmlFor={id}>
        {label}
      </label>
      {options.length > adminChoicePageSize ? (
        <SearchInput
          disabled={disabled}
          label={label}
          onChange={(next) => {
            setSearch(next);
            setPage(0);
          }}
          value={search}
        />
      ) : null}
      <select
        aria-describedby={describedBy === "" ? undefined : describedBy}
        aria-invalid={hasText(error)}
        className="admin-field-input max-w-none"
        disabled={disabled}
        id={id}
        name={name}
        onChange={(event) => {
          onValueChange(event.currentTarget.value);
        }}
        value={chosen === undefined ? "" : value}
      >
        <option disabled value="">
          {placeholder}
        </option>
        {choices.map((option) => (
          <option key={option.value} value={option.value}>
            {option.detail === undefined
              ? option.label
              : `${option.label} · ${option.detail}`}
          </option>
        ))}
      </select>
      {matching.length > shown.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            aria-label={`Предыдущие варианты: ${label}`}
            className="min-h-11"
            disabled={currentPage === 0 || disabled}
            onClick={() => {
              setPage(currentPage - 1);
            }}
            type="button"
            variant="outline"
          >
            Назад
          </Button>
          <span className="text-xs text-muted-foreground" role="status">
            {currentPage * adminChoicePageSize + 1}–
            {Math.min((currentPage + 1) * adminChoicePageSize, matching.length)}{" "}
            из {matching.length}
          </span>
          <Button
            aria-label={`Следующие варианты: ${label}`}
            className="min-h-11"
            disabled={currentPage === lastPage || disabled}
            onClick={() => {
              setPage(currentPage + 1);
            }}
            type="button"
            variant="outline"
          >
            Далее
          </Button>
        </div>
      ) : null}
      {matching.length === 0 ? (
        <p className="admin-field-hint">По этому запросу ничего не найдено.</p>
      ) : null}
      {hasText(hint) ? (
        <p className="admin-field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {hasText(error) ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : null}
    </div>
  );
}

/**
 * Выбор нескольких вариантов из полного списка владельца: выбранные стоят плашками сверху, ниже
 * поиск и флажки по двадцать с продолжением «Показать ещё». Поиск и продолжение не сбрасывают
 * уже выбранное.
 */
export function AdminSearchChecklist({
  label,
  options,
  values,
  onValuesChange,
  disabled = false,
  hint,
  error,
  emptySelection,
  unknownLabel = "Вариант вне списка",
}: {
  readonly label: string;
  readonly options: readonly AdminChoice[];
  readonly values: readonly string[];
  readonly onValuesChange: (values: readonly string[]) => void;
  readonly disabled?: boolean;
  readonly hint?: string;
  readonly error?: string;
  /** Что значит пустой выбор, например «Все продукты». */
  readonly emptySelection?: string;
  /** Подпись выбранного значения, которого нет среди вариантов. */
  readonly unknownLabel?: string;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(adminChoicePageSize);
  const matching = options.filter((option) => matches(option, search));
  const shown = matching.slice(0, limit);
  const selected = values.map(
    (value) =>
      options.find((option) => option.value === value) ?? {
        value,
        label: unknownLabel,
      },
  );
  const toggle = (value: string, checked: boolean) => {
    onValuesChange(
      checked
        ? [...values.filter((item) => item !== value), value]
        : values.filter((item) => item !== value),
    );
  };
  const legendId = `${id}-legend`;
  const describedBy = [
    hasText(hint) ? `${id}-hint` : null,
    hasText(error) ? `${id}-error` : null,
  ]
    .filter((part) => part !== null)
    .join(" ");

  return (
    <fieldset
      aria-describedby={describedBy === "" ? undefined : describedBy}
      aria-labelledby={legendId}
      className="admin-field m-0 border-0 p-0"
      disabled={disabled}
    >
      <legend className="admin-field-label" id={legendId}>
        {label}
      </legend>
      {selected.length === 0 ? (
        hasText(emptySelection) ? (
          <p className="admin-field-hint">{emptySelection}</p>
        ) : null
      ) : (
        <ul aria-label={`Выбрано: ${label}`} className="admin-filter-chips">
          {selected.map((choice) => (
            <li
              className="admin-filter-chip"
              data-removable=""
              key={choice.value}
            >
              {choice.label}
              <button
                aria-label={`Убрать «${choice.label}»`}
                onClick={() => {
                  toggle(choice.value, false);
                }}
                type="button"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {options.length > adminChoicePageSize ? (
        <SearchInput
          disabled={disabled}
          label={label}
          onChange={(next) => {
            setSearch(next);
            setLimit(adminChoicePageSize);
          }}
          value={search}
        />
      ) : null}
      <ul className="admin-checklist">
        {shown.map((option) => (
          <li key={option.value}>
            <label className="admin-checklist-item">
              <input
                checked={values.includes(option.value)}
                onChange={(event) => {
                  toggle(option.value, event.currentTarget.checked);
                }}
                type="checkbox"
                value={option.value}
              />
              <span className="grid min-w-0">
                <span className="truncate">{option.label}</span>
                {option.detail === undefined ? null : (
                  <span className="admin-field-hint">{option.detail}</span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {matching.length > shown.length ? (
        <Button
          className="min-h-11 justify-self-start"
          onClick={() => {
            setLimit(limit + adminChoicePageSize);
          }}
          type="button"
          variant="outline"
        >
          Показать ещё{" "}
          {Math.min(adminChoicePageSize, matching.length - shown.length)} из{" "}
          {matching.length - shown.length}
        </Button>
      ) : null}
      {matching.length === 0 ? (
        <p className="admin-field-hint">По этому запросу ничего не найдено.</p>
      ) : null}
      {hasText(hint) ? (
        <p className="admin-field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {hasText(error) ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : null}
    </fieldset>
  );
}
