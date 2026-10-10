"use client";

import { ArrowLeft, Bookmark, Circle, List } from "lucide-react";
import type { ReactNode } from "react";

import { materialReadingLabels } from "@/entities/material";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import { Button } from "@/shared/ui/button";
import type { SeriesReaderContext } from "../model/series-reader-context";

/** Одна панель для начала и конца материала; её состав не зависит от измерения после гидратации. */
export function ReaderTopActions({
  context,
  readingAction,
  bookmarkAction,
  returnAction,
  format = "guide",
  position = "top",
  extraAction,
}: {
  readonly context: SeriesReaderContext | null;
  readonly readingAction?: ReactNode;
  readonly bookmarkAction?: ReactNode;
  readonly returnAction?: ReactNode;
  readonly format?: string;
  readonly position?: "top" | "bottom";
  readonly extraAction?: ReactNode;
}) {
  const link =
    "inline-flex min-h-11 items-center gap-1.5 px-1 text-xs text-muted-foreground no-underline hover:text-foreground focus-visible:outline-ring sm:px-2 sm:text-sm";
  if (
    context === null &&
    readingAction === undefined &&
    bookmarkAction === undefined &&
    returnAction === undefined &&
    extraAction === undefined
  )
    return null;
  return (
    <div className="@container/reader-actions" data-reader-top-actions-slot>
      <nav
        aria-label={
          position === "top"
            ? "Действия материала"
            : "Действия в конце материала"
        }
        className={`flex flex-wrap items-center gap-x-1 rounded-xl border border-border bg-muted/40 px-1 py-1 [&_button]:text-xs sm:[&_button]:text-sm ${position === "bottom" ? "sm:border-0 sm:bg-transparent sm:px-0" : ""}`}
        data-reader-top-actions
      >
        {context === null ? (
          returnAction === undefined ? null : (
            <div className="flex min-h-11 w-full min-w-0 items-center px-1 @min-[16rem]/reader-actions:w-auto @min-[16rem]/reader-actions:flex-1 [&_a]:text-xs sm:[&_a]:text-sm">
              {returnAction}
            </div>
          )
        ) : (
          <div
            className={`flex w-full min-w-0 flex-wrap items-center gap-x-1 @min-[16rem]/reader-actions:w-auto @min-[16rem]/reader-actions:flex-1 ${position === "bottom" ? "sm:hidden" : ""}`}
          >
            {context.previous === null || position === "bottom" ? null : (
              <IntentPrefetchLink
                className={`${link} hidden sm:inline-flex`}
                href={context.previous.href}
                title={context.previous.title}
              >
                <ArrowLeft aria-hidden="true" className="size-4" /> Назад
              </IntentPrefetchLink>
            )}
            <IntentPrefetchLink
              className={`${link} min-w-0 justify-start`}
              href={context.series.href}
              aria-label="Открыть программу"
            >
              <List
                aria-hidden="true"
                className="size-4 @max-[18rem]/reader-actions:hidden"
              />{" "}
              Программа
            </IntentPrefetchLink>
          </div>
        )}
        {extraAction}
        <div className="ml-auto flex max-w-full flex-wrap items-start justify-end gap-1 @min-[16rem]/reader-actions:flex-nowrap">
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
              {materialReadingLabels(format).complete}
            </Button>
          )}
        </div>
      </nav>
    </div>
  );
}
