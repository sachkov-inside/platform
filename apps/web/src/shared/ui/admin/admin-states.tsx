import { CircleAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/shared/ui/button";

import "./admin.css";

/** Первый запуск: данных ещё нет. Заменяет всю таблицу вместе с заголовками колонок. */
export function AdminEmptyState({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description: string;
  /** Одно действие создания: «Создать продукт». */
  readonly action?: ReactNode;
}) {
  return (
    <section className="admin-state">
      <h2>{title}</h2>
      <p>{description}</p>
      {action === undefined ? null : (
        <div className="admin-state-actions">{action}</div>
      )}
    </section>
  );
}

/** Фильтры ничего не нашли: предлагает их сбросить. */
export function AdminNoResults({
  title = "Ничего не найдено",
  description,
  onReset,
  resetLabel = "Сбросить фильтры",
}: {
  readonly title?: string;
  readonly description: string;
  readonly onReset?: () => void;
  readonly resetLabel?: string;
}) {
  return (
    <section className="admin-state">
      <h2>{title}</h2>
      <p>{description}</p>
      {onReset === undefined ? null : (
        <div className="admin-state-actions">
          <Button
            className="min-h-11 px-4"
            onClick={onReset}
            type="button"
            variant="outline"
          >
            {resetLabel}
          </Button>
        </div>
      )}
    </section>
  );
}

/** Чтение не удалось: причина, следующий шаг и повтор. */
export function AdminErrorState({
  title,
  description,
  reference,
  onRetry,
  retry,
}: {
  readonly title: string;
  readonly description: string;
  /** Код для обращения в поддержку. */
  readonly reference?: string;
  readonly onRetry?: () => void;
  /** Своя кнопка повтора, например `RetryPageButton`, вместо `onRetry`. */
  readonly retry?: ReactNode;
}) {
  return (
    <section className="admin-state" data-tone="critical" role="alert">
      <h2>
        <CircleAlert aria-hidden="true" className="size-5" />
        {title}
      </h2>
      <p>{description}</p>
      {reference === undefined ? null : (
        <p className="admin-state-reference">Код обращения: {reference}</p>
      )}
      {retry === undefined && onRetry === undefined ? null : (
        <div className="admin-state-actions">
          {retry ?? (
            <Button
              className="min-h-11 px-4"
              onClick={onRetry}
              type="button"
              variant="outline"
            >
              Повторить
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/** Объекта по адресу нет: ссылка обратно в список. */
export function AdminNotFound({
  title,
  description,
  backHref,
  backLabel,
}: {
  readonly title: string;
  readonly description: string;
  readonly backHref: Route;
  readonly backLabel: string;
}) {
  return (
    <section className="admin-state">
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="admin-state-actions">
        <Button asChild className="min-h-11 px-4" variant="outline">
          <Link href={backHref}>{backLabel}</Link>
        </Button>
      </div>
    </section>
  );
}

const barWidths = ["62%", "48%", "56%", "40%", "52%", "44%"] as const;

/**
 * Загрузка списка в геометрии настоящей таблицы: та же высота заголовка и строк, тот же телефонный
 * список. Таблица, пришедшая на место скелета, не сдвигает ни строку, ни то, что ниже.
 */
export function AdminTableSkeleton({
  columns,
  rows = 8,
  label = "Загружаем список",
}: {
  /** Число колонок настоящей таблицы, включая колонку действий. */
  readonly columns: number;
  readonly rows?: number;
  readonly label?: string;
}) {
  const columnIndices = Array.from({ length: columns }, (_, index) => index);
  const rowIndices = Array.from({ length: rows }, (_, index) => index);
  return (
    <div className="admin-table-root" role="status">
      <span className="sr-only">{label}</span>
      <table aria-hidden="true" className="admin-table">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {columnIndices.map((column) => (
              <th key={column}>
                <span
                  className="admin-skeleton-bar"
                  style={{ width: column === 0 ? "30%" : "50%" }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowIndices.map((row) => (
            <tr key={row}>
              {columnIndices.map((column) => (
                <td key={column}>
                  <span
                    className="admin-skeleton-bar"
                    style={{
                      width:
                        barWidths[(row + column) % barWidths.length] ?? "50%",
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul aria-hidden="true" className="admin-list">
        {rowIndices.map((row) => (
          <li className="admin-list-item" key={row}>
            <span className="admin-list-item-main gap-2">
              <span
                className="admin-skeleton-bar h-3"
                style={{ width: barWidths[row % barWidths.length] ?? "50%" }}
              />
              <span className="admin-skeleton-bar" style={{ width: "36%" }} />
              <span
                className="admin-skeleton-bar h-4"
                style={{ width: "24%" }}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const skeletonControl = {
  height: "2.75rem",
  borderRadius: "var(--radius-xl)",
} as const;

/**
 * Строка поиска и фильтров, пока список загружается: та же раскладка, что у `AdminFilterBar` без
 * применённых фильтров (поиск во всю ширину и выборы по два в ряд на телефоне, одна строка с 40rem
 * колонки). Скелет страницы ставит её между заголовком и таблицей, и таблица не прыгает.
 */
export function AdminFilterBarSkeleton({
  search = true,
  filters,
}: {
  readonly search?: boolean;
  /** Число выборов настоящей строки фильтров. */
  readonly filters: number;
}) {
  const lastSelectWide = filters % 2 === 1;
  const filterIndices = Array.from({ length: filters }, (_, index) => index);
  return (
    <div aria-hidden="true" className="admin-filter-bar">
      <div className="admin-filter-controls">
        {search ? (
          <div className="admin-search" data-wide="">
            <span className="admin-skeleton-bar" style={skeletonControl} />
          </div>
        ) : null}
        {filterIndices.map((index) => (
          <div
            className="admin-filter-select"
            data-wide={lastSelectWide && index === filters - 1 ? "" : undefined}
            key={index}
          >
            <span className="admin-skeleton-bar" style={skeletonControl} />
          </div>
        ))}
      </div>
    </div>
  );
}
