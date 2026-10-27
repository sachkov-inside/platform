"use client";

import { Search, X } from "lucide-react";
import { useId } from "react";

import { presentText } from "@/shared/lib/text";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

import "./admin.css";

export interface AdminSelectFilter {
  readonly id: string;
  /** Доступное имя выбора, например «Тема». */
  readonly label: string;
  readonly value: string;
  readonly options: readonly { value: string; label: string }[];
  readonly onChange: (value: string) => void;
}

export interface AdminFilterChip {
  readonly id: string;
  /** Значение, понятное без категории: «Гайд», «Без комментария». */
  readonly label: string;
  /** Без обработчика это фильтр по умолчанию, его нельзя убрать. */
  readonly onRemove?: () => void;
}

export interface AdminFilterSearch {
  /** Что ищем: «Поиск по материалам». */
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly maxLength?: number;
}

export interface AdminFilterBarProps {
  readonly search?: AdminFilterSearch | undefined;
  /** 0–3 выбора. */
  readonly filters: readonly AdminSelectFilter[];
  /** Применённые фильтры, по одной плашке на категорию. */
  readonly chips: readonly AdminFilterChip[];
  /** «Сбросить» видна, когда обработчик передан. */
  readonly onReset?: (() => void) | undefined;
  /** «12 материалов»; озвучивается вежливо при изменении. */
  readonly resultLabel?: string | undefined;
}

/**
 * Поиск и фильтры списка одной строкой. Модуль только показывает состояние и сообщает о выборе:
 * адрес страницы хранит его сама страница.
 */
export function AdminFilterBar({
  search,
  filters,
  chips,
  onReset,
  resultLabel,
}: AdminFilterBarProps) {
  const id = useId();
  const searchId = `${id}-search`;
  // На телефоне выборы стоят по два в ряд; непарный последний занимает весь ряд.
  const lastSelectWide = filters.length % 2 === 1;

  return (
    <div className="admin-filter-bar">
      <div className="admin-filter-controls">
        {search === undefined ? null : (
          <div className="admin-search" data-wide="">
            <label className="sr-only" htmlFor={searchId}>
              {search.label}
            </label>
            <Search aria-hidden="true" className="admin-search-icon" />
            <input
              autoComplete="off"
              enterKeyHint="search"
              id={searchId}
              maxLength={search.maxLength}
              onChange={(event) => {
                search.onChange(event.currentTarget.value);
              }}
              placeholder={search.placeholder}
              type="search"
              value={search.value}
            />
            {search.value === "" ? null : (
              <button
                aria-label="Очистить поиск"
                className="admin-search-clear"
                onClick={() => {
                  search.onChange("");
                  document.getElementById(searchId)?.focus();
                }}
                type="button"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            )}
          </div>
        )}
        {filters.map((filter, index) => (
          <div
            className="admin-filter-select"
            data-wide={
              lastSelectWide && index === filters.length - 1 ? "" : undefined
            }
            key={filter.id}
          >
            <Select
              onValueChange={(value) => {
                // Radix повторяет значение скрытого native select, когда список возвращается
                // после скрытия навигацией (ADR 0027): пустое или прежнее значение не выбор.
                if (
                  value === "" ||
                  value === filter.value ||
                  !filter.options.some((option) => option.value === value)
                )
                  return;
                filter.onChange(value);
              }}
              value={filter.value}
            >
              <SelectTrigger aria-label={filter.label}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {filter.options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <div className="admin-filter-applied">
        {chips.length === 0 ? null : (
          <ul aria-label="Применённые фильтры" className="admin-filter-chips">
            {chips.map((chip) => (
              <li
                className="admin-filter-chip"
                data-removable={chip.onRemove === undefined ? undefined : ""}
                key={chip.id}
              >
                {chip.label}
                {chip.onRemove === undefined ? null : (
                  <button
                    aria-label={`Убрать фильтр «${chip.label}»`}
                    onClick={chip.onRemove}
                    type="button"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {onReset === undefined ? null : (
          <button className="admin-text-button" onClick={onReset} type="button">
            Сбросить
          </button>
        )}
        {/* Область озвучивания живёт всегда: новая область с текстом не была бы прочитана. */}
        <p aria-live="polite" className="admin-filter-result" role="status">
          {presentText(resultLabel) ?? ""}
        </p>
      </div>
    </div>
  );
}
