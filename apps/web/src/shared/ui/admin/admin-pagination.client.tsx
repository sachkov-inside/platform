"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { hasText } from "@/shared/lib/text";
import { buttonVariants } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";

import "./admin.css";

const stepClass = cn(
  buttonVariants({ variant: "outline" }),
  "min-h-11 min-w-11 gap-1.5 px-3",
);

/**
 * Постраничный вывод под таблицей: «Предыдущая», «Страница 2 из 6», «Следующая» и диапазон записей.
 * Ссылки (`hrefFor`) держат страницу в адресе; `onPage` нужен списку, которым владеет браузер.
 */
export function AdminPagination({
  label,
  page,
  totalPages,
  hrefFor,
  onPage,
  summary,
}: {
  /** Имя навигации: «Страницы материалов». */
  readonly label: string;
  /** Номер текущей страницы с единицы. */
  readonly page: number;
  readonly totalPages: number;
  readonly hrefFor?: (page: number) => Route;
  readonly onPage?: (page: number) => void;
  /** «21–40 из 112». */
  readonly summary?: string;
}) {
  const summaryText = hasText(summary) ? (
    <p className="admin-pagination-summary">{summary}</p>
  ) : null;
  if (totalPages <= 1)
    return summaryText === null ? null : (
      <div className="admin-pagination">{summaryText}</div>
    );

  const step = (target: number, direction: "previous" | "next") => {
    const available = target >= 1 && target <= totalPages;
    const content =
      direction === "previous" ? (
        <>
          <ChevronLeft aria-hidden="true" />
          <StepText>Предыдущая</StepText>
        </>
      ) : (
        <>
          <StepText>Следующая</StepText>
          <ChevronRight aria-hidden="true" />
        </>
      );
    if (!available)
      return (
        <button className={stepClass} disabled type="button">
          {content}
        </button>
      );
    if (hrefFor !== undefined)
      return (
        <Link className={stepClass} href={hrefFor(target)}>
          {content}
        </Link>
      );
    return (
      <button
        className={stepClass}
        onClick={() => onPage?.(target)}
        type="button"
      >
        {content}
      </button>
    );
  };

  return (
    <nav aria-label={label} className="admin-pagination">
      {summaryText}
      <div className="admin-pagination-controls">
        {step(page - 1, "previous")}
        <p className="admin-pagination-page">
          Страница {page} из {totalPages}
        </p>
        {step(page + 1, "next")}
      </div>
    </nav>
  );
}

/** Подпись шага: на телефоне видна только стрелка, имя остаётся для чтения с экрана. */
function StepText({ children }: { readonly children: ReactNode }) {
  return (
    <span>
      <span className="max-sm:sr-only">{children}</span>
      <span className="sr-only"> страница</span>
    </span>
  );
}

/** Курсорный вывод журнала: «К новым» и «Более ранние» без номеров страниц. */
export function AdminCursorPagination({
  label,
  newerHref,
  olderHref,
  newerLabel = "К новым",
  olderLabel = "Более ранние",
}: {
  readonly label: string;
  readonly newerHref: Route | null;
  readonly olderHref: Route | null;
  readonly newerLabel?: string;
  readonly olderLabel?: string;
}) {
  if (newerHref === null && olderHref === null) return null;
  return (
    <nav aria-label={label} className="admin-pagination">
      <div className="admin-pagination-controls">
        {newerHref === null ? (
          <button className={stepClass} disabled type="button">
            <ChevronLeft aria-hidden="true" />
            {newerLabel}
          </button>
        ) : (
          <Link className={stepClass} href={newerHref}>
            <ChevronLeft aria-hidden="true" />
            {newerLabel}
          </Link>
        )}
        {olderHref === null ? (
          <button className={stepClass} disabled type="button">
            {olderLabel}
            <ChevronRight aria-hidden="true" />
          </button>
        ) : (
          <Link className={stepClass} href={olderHref}>
            {olderLabel}
            <ChevronRight aria-hidden="true" />
          </Link>
        )}
      </div>
    </nav>
  );
}
