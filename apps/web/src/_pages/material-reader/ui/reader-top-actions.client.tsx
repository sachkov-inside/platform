"use client";

import { ArrowLeft, ArrowRight, Bookmark, Circle, List } from "lucide-react";
import type { ReactNode } from "react";

import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import { Button } from "@/shared/ui/button";
import type { SeriesReaderContext } from "../model/series-reader-context";

/** Одни и те же верхние действия не зависят от длины материала и измерения после гидратации. */
export function ReaderTopActions({
  context,
  readingAction,
  bookmarkAction,
  returnAction,
}: {
  readonly context: SeriesReaderContext | null;
  readonly readingAction?: ReactNode;
  readonly bookmarkAction?: ReactNode;
  readonly returnAction?: ReactNode;
}) {
  const link =
    "inline-flex min-h-11 items-center gap-1.5 px-2 text-sm text-muted-foreground no-underline hover:text-foreground focus-visible:outline-ring";
  if (
    context === null &&
    readingAction === undefined &&
    bookmarkAction === undefined &&
    returnAction === undefined
  )
    return null;
  return (
    <div data-reader-top-actions-slot>
      <nav
        aria-label="Действия материала"
        className="flex flex-wrap items-center justify-between gap-x-2 rounded-xl border border-border bg-muted/40 px-2 py-1"
        data-reader-top-actions
      >
        {context === null ? (
          <div className="flex min-h-11 w-full items-center px-2 sm:w-auto">
            {returnAction}
          </div>
        ) : (
          <div className="grid w-full grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center sm:flex sm:w-auto sm:flex-wrap sm:gap-x-1">
            {context.previous === null ? (
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
            <IntentPrefetchLink
              className={`${link} justify-center sm:justify-start`}
              href={context.series.href}
              aria-label="Открыть программу"
            >
              <List aria-hidden="true" className="size-4" /> Программа
            </IntentPrefetchLink>
            {context.next === null ? (
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
        )}
        <div className="ml-auto flex w-full max-w-full flex-wrap items-start justify-end gap-1 border-t border-border pt-1 sm:w-auto sm:border-0 sm:pt-0">
          {bookmarkAction ?? (
            <Button
              aria-label="Закладка недоступна"
              disabled
              className="size-11 rounded-lg p-0"
              variant="ghost"
            >
              <Bookmark aria-hidden="true" />
            </Button>
          )}
          {readingAction ?? (
            <Button disabled className="h-11 rounded-lg px-3" variant="outline">
              <Circle aria-hidden="true" />
              Изучено
            </Button>
          )}
        </div>
      </nav>
    </div>
  );
}
