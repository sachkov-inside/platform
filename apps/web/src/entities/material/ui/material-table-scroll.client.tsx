"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

type Overflow = "none" | "start" | "end" | "both";

function overflowOf(element: HTMLElement): Overflow {
  const hidden = element.scrollWidth - element.clientWidth;
  if (hidden <= 1) return "none";
  const atStart = element.scrollLeft <= 1;
  const atEnd = element.scrollLeft >= hidden - 1;
  if (atStart) return "end";
  if (atEnd) return "start";
  return "both";
}

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
  const scroller = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<Overflow>("none");

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const update = () => setOverflow(overflowOf(element));
    update();
    element.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      resize.disconnect();
    };
  }, []);

  const showStart = overflow === "start" || overflow === "both";
  const showEnd = overflow === "end" || overflow === "both";

  return (
    <div
      className="relative mt-8 max-w-full overflow-hidden rounded-xl border border-border"
      data-overflow={overflow}
      data-reader-block="table"
    >
      <div
        aria-label="Таблица в материале"
        className="max-w-full overflow-x-auto overscroll-x-contain [scrollbar-color:var(--muted-foreground)_var(--muted)]"
        data-table-scroll=""
        ref={scroller}
        role="region"
        tabIndex={0}
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        className={`${fade} left-0 bg-linear-to-r from-foreground/15 to-transparent`}
        data-table-fade="start"
        style={showStart ? { opacity: 1 } : undefined}
      />
      <div
        aria-hidden="true"
        className={`${fade} right-0 bg-linear-to-l from-foreground/15 to-transparent`}
        data-table-fade="end"
        style={showEnd ? { opacity: 1 } : undefined}
      />
    </div>
  );
}
