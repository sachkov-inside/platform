"use client";

import { ArrowLeft, ArrowRight, List } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import type { SeriesReaderContext } from "../model/series-reader-context";

/** Верхние дубликаты нужны, только когда весь материал не помещается на экране. */
export function ReaderTopActions({
  context,
  readingAction,
  bookmarkAction,
}: {
  readonly context: SeriesReaderContext | null;
  readonly readingAction?: ReactNode;
  readonly bookmarkAction?: ReactNode;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  useEffect(() => {
    const toolbar = slot.current;
    const reader = toolbar?.closest<HTMLElement>(
      "[data-material-reader-state]",
    );
    if (toolbar === null || reader === null || reader === undefined) return;
    const scroller = reader.closest<HTMLElement>("[data-application-content]");
    const measure = () => {
      const scrollsInside =
        scroller !== null &&
        ["auto", "scroll"].includes(getComputedStyle(scroller).overflowY);
      const viewport = scrollsInside
        ? scroller.clientHeight
        : window.innerHeight;
      // Вычитаем саму строку, чтобы её появление не делало короткий материал длинным.
      setLong(reader.scrollHeight - toolbar.offsetHeight > viewport);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(reader);
    observer.observe(scroller ?? document.documentElement);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const link =
    "inline-flex min-h-11 items-center gap-1.5 px-2 text-sm text-muted-foreground no-underline hover:text-foreground focus-visible:outline-ring";
  return (
    <div ref={slot}>
      {!long ||
      (context === null &&
        readingAction === undefined &&
        bookmarkAction === undefined) ? null : (
        <nav
          aria-label="Действия материала"
          className="flex flex-wrap items-center justify-between gap-x-2 pt-4"
          data-reader-top-actions
        >
          <div className="flex flex-wrap items-center gap-x-1">
            {context?.previous === null ||
            context?.previous === undefined ? null : (
              <IntentPrefetchLink
                className={link}
                href={context.previous.href}
                title={context.previous.title}
              >
                <ArrowLeft aria-hidden="true" className="size-4" /> Назад
              </IntentPrefetchLink>
            )}
            {context === null ? null : (
              <IntentPrefetchLink
                className={link}
                href={context.series.href}
                aria-label="Открыть программу"
              >
                <List aria-hidden="true" className="size-4" /> Программа
              </IntentPrefetchLink>
            )}
            {context?.next === null || context?.next === undefined ? null : (
              <IntentPrefetchLink
                className={link}
                href={context.next.href}
                title={context.next.title}
              >
                Дальше <ArrowRight aria-hidden="true" className="size-4" />
              </IntentPrefetchLink>
            )}
          </div>
          <div className="flex items-start gap-1">
            {bookmarkAction}
            {readingAction}
          </div>
        </nav>
      )}
    </div>
  );
}
