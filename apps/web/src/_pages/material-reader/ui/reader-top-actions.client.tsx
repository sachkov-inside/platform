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
  if (
    context === null &&
    readingAction === undefined &&
    bookmarkAction === undefined
  )
    return null;
  return (
    <div ref={slot} className="pb-6" data-reader-top-actions-slot>
      {/* Место занято до измерения: появление действий не сдвигает заголовок. */}
      <nav
        aria-label="Действия материала"
        aria-hidden={!long}
        inert={!long}
        className={`flex flex-wrap items-center justify-between gap-x-2 rounded-xl border border-border bg-muted/40 px-2 py-1${long ? "" : " invisible"}`}
        data-reader-top-actions={long ? "" : undefined}
      >
        <div className="grid w-full grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center sm:flex sm:w-auto sm:flex-wrap sm:gap-x-1">
          {context?.previous === null || context?.previous === undefined ? (
            <span
              aria-hidden="true"
              className="grid size-11 place-items-center text-muted-foreground/40 sm:hidden"
            >
              <ArrowLeft className="size-4" />
            </span>
          ) : (
            <IntentPrefetchLink
              className={`${link} justify-center sm:justify-start`}
              href={context.previous.href}
              title={context.previous.title}
            >
              <ArrowLeft aria-hidden="true" className="size-4" />{" "}
              <span className="sr-only sm:not-sr-only">Назад</span>
            </IntentPrefetchLink>
          )}
          {context === null ? null : (
            <IntentPrefetchLink
              className={`${link} justify-center sm:justify-start`}
              href={context.series.href}
              aria-label="Открыть программу"
            >
              <List aria-hidden="true" className="size-4" /> Программа
            </IntentPrefetchLink>
          )}
          {context?.next === null || context?.next === undefined ? (
            <span
              aria-hidden="true"
              className="grid size-11 place-items-center text-muted-foreground/40 sm:hidden"
            >
              <ArrowRight className="size-4" />
            </span>
          ) : (
            <IntentPrefetchLink
              className={`${link} justify-center sm:justify-start`}
              href={context.next.href}
              title={context.next.title}
            >
              <span className="sr-only sm:not-sr-only">Дальше</span>{" "}
              <ArrowRight aria-hidden="true" className="size-4" />
            </IntentPrefetchLink>
          )}
        </div>
        <div className="ml-auto flex w-full items-start justify-end gap-1 border-t border-border pt-1 sm:w-auto sm:border-0 sm:pt-0">
          {bookmarkAction}
          {readingAction}
        </div>
      </nav>
    </div>
  );
}
