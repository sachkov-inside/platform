"use client";

import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Circle,
  List,
} from "lucide-react";
import type { ReactNode } from "react";

import { materialReadingLabels } from "@/entities/material";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import type { SeriesReaderContext } from "../model/series-reader-context";
import styles from "./reader-top-actions.module.css";

/** Одна панель для начала и конца материала; её состав не зависит от измерения после гидратации. */
export function ReaderTopActions({
  context,
  readingAction,
  bookmarkAction,
  returnAction,
  format = "guide",
  position = "top",
}: {
  readonly context: SeriesReaderContext | null;
  readonly readingAction?: ReactNode;
  readonly bookmarkAction?: ReactNode;
  readonly returnAction?: ReactNode;
  readonly format?: string;
  readonly position?: "top" | "bottom";
}) {
  const link =
    "inline-flex h-9 min-h-9 items-center gap-1.5 px-1 text-xs text-muted-foreground no-underline hover:text-foreground focus-visible:outline-ring sm:h-11 sm:min-h-11 sm:px-2 sm:text-sm";
  if (
    context === null &&
    readingAction === undefined &&
    bookmarkAction === undefined &&
    returnAction === undefined
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
        className={cn(
          styles.panel,
          "flex flex-wrap items-center gap-x-0.5 rounded-xl border border-border bg-muted/40 p-0 [&_a]:text-xs [&_button]:text-xs sm:p-0.5 sm:[&_a]:text-sm sm:[&_button]:text-sm",
        )}
        data-reader-top-actions
      >
        {context === null ? (
          returnAction === undefined ? null : (
            <div className="flex min-h-9 w-full sm:min-h-11 min-w-0 items-center px-1 @min-[16rem]/reader-actions:w-auto @min-[16rem]/reader-actions:flex-1 [&_a]:text-xs sm:[&_a]:text-sm">
              {returnAction}
            </div>
          )
        ) : (
          <div className="flex min-w-0 flex-wrap items-center @min-[16rem]/reader-actions:flex-1">
            {context.previous === null ? (
              <span
                aria-hidden="true"
                className="grid h-9 w-11 shrink-0 sm:h-11 place-items-center text-muted-foreground/40"
              >
                <ChevronLeft className="size-4" />
              </span>
            ) : (
              <IntentPrefetchLink
                aria-label="Предыдущий урок"
                className={`${link} w-11 shrink-0 justify-center rounded-lg hover:bg-muted`}
                href={context.previous.href}
                title={context.previous.title}
              >
                <ChevronLeft aria-hidden="true" className="size-4" />
              </IntentPrefetchLink>
            )}
            <IntentPrefetchLink
              className={`${link} min-w-11 justify-center rounded-lg hover:bg-muted`}
              href={context.series.href}
              aria-label="Открыть программу"
              title="Открыть программу"
            >
              <List aria-hidden="true" className="size-4" />
              <span className="@max-[19rem]/reader-actions:sr-only">
                Программа
              </span>
            </IntentPrefetchLink>
            {context.next === null ? (
              <span
                aria-hidden="true"
                className="grid h-9 w-11 shrink-0 sm:h-11 place-items-center text-muted-foreground/40"
              >
                <ChevronRight className="size-4" />
              </span>
            ) : (
              <IntentPrefetchLink
                aria-label="Следующий урок"
                className={`${link} w-11 shrink-0 justify-center rounded-lg hover:bg-muted`}
                href={context.next.href}
                title={context.next.title}
              >
                <ChevronRight aria-hidden="true" className="size-4" />
              </IntentPrefetchLink>
            )}
          </div>
        )}
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
