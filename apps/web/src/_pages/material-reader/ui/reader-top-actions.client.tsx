"use client";

import { ArrowRight, Bookmark, Circle } from "lucide-react";
import type { ReactNode } from "react";

import { materialReadingLabels } from "@/entities/material";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import { Button } from "@/shared/ui/button";
import type {
  SeriesReaderContext,
  SeriesReaderContextItem,
} from "../model/series-reader-context";
import styles from "./reader-top-actions.module.css";

/** Accepted A (#1591): one left action group and the next step at the right edge. */
export function ReaderTopActions({
  context,
  readingAction,
  bookmarkAction,
  returnAction,
  shareAction,
  nextStep,
  format = "guide",
  position = "top",
}: {
  readonly context: SeriesReaderContext | null;
  readonly readingAction?: ReactNode;
  readonly bookmarkAction?: ReactNode;
  readonly returnAction?: ReactNode;
  readonly shareAction?: ReactNode;
  readonly nextStep?:
    Pick<SeriesReaderContextItem, "href" | "title"> | null | undefined;
  readonly format?: string;
  readonly position?: "top" | "bottom";
}) {
  const next = nextStep === undefined ? context?.next : nextStep;
  return (
    <div className={styles["slot"]} data-reader-top-actions-slot>
      <nav
        aria-label={
          position === "top"
            ? "Действия материала"
            : "Действия в конце материала"
        }
        className={styles["panel"]}
        data-reader-top-actions
      >
        <div className={styles["controls"]}>
          <div className={styles["return"]}>{returnAction}</div>
          <div className={styles["bookmark"]}>
            {bookmarkAction ?? (
              <Button
                disabled
                className="shrink-0"
                variant="ghost"
                aria-label="Закладка недоступна"
              >
                <Bookmark aria-hidden="true" />
                <span>Сохранить</span>
              </Button>
            )}
          </div>
          <div
            className={styles["reading"]}
            role="group"
            aria-label="Отметка изучения"
            data-reader-study-controls
          >
            {readingAction ?? (
              <Button disabled className="shrink-0" variant="ghost">
                <Circle aria-hidden="true" />
                <span>{materialReadingLabels(format).complete}</span>
              </Button>
            )}
          </div>
          {shareAction}
        </div>
        {next == null ? null : (
          <div className={styles["forward"]}>
            <Button asChild>
              <IntentPrefetchLink
                href={next.href}
                title={next.title}
                aria-label="Дальше"
              >
                <span>Дальше</span>
                <ArrowRight aria-hidden="true" />
              </IntentPrefetchLink>
            </Button>
          </div>
        )}
      </nav>
    </div>
  );
}
