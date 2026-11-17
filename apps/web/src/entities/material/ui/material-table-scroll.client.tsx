"use client";

import type { ReactNode } from "react";

import { mountMaterialTableScroll } from "./material-table-scroll.browser";

const fade =
  "pointer-events-none absolute inset-y-0 z-10 w-8 opacity-0 transition-opacity duration-(--motion-duration-fast)";

/**
 * Таблица шире экрана прокручивается внутри рамки. Край, за которым остались столбцы, затенён,
 * поэтому читатель видит, что таблица продолжается.
 */
export function MaterialTableScroll({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <div
      className="relative mt-8 max-w-full overflow-hidden rounded-xl border border-border"
      data-overflow="none"
      data-reader-block="table"
    >
      <div
        aria-label="Таблица в материале"
        className="max-w-full overflow-x-auto overscroll-x-contain [scrollbar-color:var(--muted-foreground)_var(--muted)]"
        data-table-scroll=""
        ref={mountMaterialTableScroll}
        role="region"
        tabIndex={0}
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        className={`${fade} left-0 bg-linear-to-r from-foreground/15 to-transparent`}
        data-table-fade="start"
      />
      <div
        aria-hidden="true"
        className={`${fade} right-0 bg-linear-to-l from-foreground/15 to-transparent`}
        data-table-fade="end"
      />
    </div>
  );
}
