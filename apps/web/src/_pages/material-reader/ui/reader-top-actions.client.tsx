"use client";

import {
  ArrowRight,
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
import type {
  SeriesReaderContext,
  SeriesReaderContextItem,
} from "../model/series-reader-context";
import styles from "./reader-top-actions.module.css";

function LessonArrow({
  lesson,
  direction,
}: {
  readonly lesson: SeriesReaderContextItem | null;
  readonly direction: "previous" | "next";
}) {
  const label = direction === "previous" ? "Предыдущий урок" : "Следующий урок";
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;
  const className = "size-9 shrink-0 rounded-full p-0 text-xs sm:text-sm";
  return lesson === null ? (
    <Button
      aria-label={label}
      className={className}
      disabled
      variant="secondary"
    >
      <Icon aria-hidden="true" className="size-4" />
    </Button>
  ) : (
    <Button asChild className={className} variant="secondary">
      <IntentPrefetchLink
        aria-label={label}
        href={lesson.href}
        title={lesson.title}
      >
        <Icon aria-hidden="true" className="size-4" />
      </IntentPrefetchLink>
    </Button>
  );
}

/** Одинаковая панель в начале и конце; соседние уроки всегда по краям. */
export function ReaderTopActions({
  context,
  readingAction,
  bookmarkAction,
  returnAction,
  breadcrumbs,
  nextStep,
  format = "guide",
  position = "top",
}: {
  readonly context: SeriesReaderContext | null;
  readonly readingAction?: ReactNode;
  readonly bookmarkAction?: ReactNode;
  readonly returnAction?: ReactNode;
  readonly breadcrumbs?: ReactNode;
  readonly nextStep?:
    Pick<SeriesReaderContextItem, "href" | "title"> | null | undefined;
  readonly format?: string;
  readonly position?: "top" | "bottom";
}) {
  if (
    context === null &&
    readingAction === undefined &&
    bookmarkAction === undefined &&
    returnAction === undefined &&
    breadcrumbs === undefined
  )
    return null;
  const reading =
    readingAction === undefined ? (
      <Button disabled className="h-11 rounded-lg px-3" variant="ghost">
        <Circle aria-hidden="true" />
        {materialReadingLabels(format).complete}
      </Button>
    ) : (
      readingAction
    );
  const bookmark = bookmarkAction ?? (
    <Button
      aria-label="Закладка недоступна"
      disabled
      className="size-11 rounded-lg p-0"
      variant="ghost"
    >
      <Bookmark aria-hidden="true" />
    </Button>
  );
  return (
    <div className="@container/reader-actions" data-reader-top-actions-slot>
      {breadcrumbs}
      <nav
        aria-label={
          position === "top"
            ? "Действия материала"
            : "Действия в конце материала"
        }
        className={cn(
          styles["panel"],
          context !== null && styles["lessonPanel"],
          "items-center rounded-xl border border-border bg-muted/40 p-0 [&_a]:text-xs [&_button]:text-xs sm:p-0.5 sm:[&_a]:text-sm sm:[&_button]:text-sm",
        )}
        data-reader-top-actions
      >
        {context === null ? (
          <>
            <div className="flex min-h-9 min-w-0 items-center px-2 sm:min-h-11">
              {returnAction}
            </div>
            <div className="flex max-w-full flex-wrap items-start gap-1">
              {bookmark}
              <div
                role="group"
                aria-label="Отметка изучения"
                data-reader-study-controls
              >
                {reading}
              </div>
            </div>
            {nextStep == null ? null : (
              <div className={styles["forward"]}>
                <Button
                  asChild
                  className="h-9 gap-1.5 rounded-full px-3 sm:h-11"
                >
                  <IntentPrefetchLink
                    href={nextStep.href}
                    title={nextStep.title}
                  >
                    Дальше <ArrowRight aria-hidden="true" className="size-4" />
                  </IntentPrefetchLink>
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className={cn(styles["previous"])}>
              <LessonArrow lesson={context.previous} direction="previous" />
            </div>
            <div className={cn(styles["programme"])}>
              <IntentPrefetchLink
                className="inline-flex h-9 min-w-11 items-center justify-center gap-1.5 rounded-lg px-1 text-muted-foreground no-underline hover:bg-muted hover:text-foreground sm:h-11 sm:px-2"
                href={context.series.href}
                aria-label="Открыть программу"
                title="Открыть программу"
              >
                <List aria-hidden="true" className="size-4 shrink-0" />
                <span className="@max-[28rem]/reader-actions:sr-only">
                  Программа
                </span>
              </IntentPrefetchLink>
            </div>
            {reading == null ? null : (
              <div className={cn(styles["reading"])} data-reader-study-controls>
                {reading}
              </div>
            )}
            <div className={cn(styles["bookmark"])}>{bookmark}</div>
            <div className={cn(styles["next"])}>
              <LessonArrow lesson={context.next} direction="next" />
            </div>
          </>
        )}
      </nav>
    </div>
  );
}
