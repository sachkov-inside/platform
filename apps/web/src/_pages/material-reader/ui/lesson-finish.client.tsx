"use client";

import { ArrowRight } from "lucide-react";
import type { Route } from "next";
import { useId, type ReactNode } from "react";

import { useLessonExercisesSolved } from "@/features/exercise-attempts";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import styles from "./lesson-finish.module.css";

const primaryAction =
  "ml-auto inline-flex min-h-12 max-w-full items-center gap-2 rounded-full bg-lesson-graphite px-4 font-medium @[16rem]/finish:px-6 text-lesson-graphite-foreground no-underline transition-colors duration-(--motion-duration-fast) hover:bg-lesson-graphite-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none";

/** What the finish card leads to inside a course; outside a course the card has no actions. */
export interface LessonFinishActions {
  /** «Изучено»: the reader's own reading-state toggle. */
  readonly readingAction?: ReactNode;
  readonly next: { readonly href: Route; readonly title: string } | null;
  /** Programme page of the course: the last lesson leads there with «К программе». */
  readonly programme: Route;
}

/**
 * «Финиш урока» (решение владельца 14.11.2026, концепция A): одна тихая карточка в конце урока.
 * Заголовок, строки «Упражнения» и «Как вам урок?», а внутри курса ещё «Изучено»
 * и главная кнопка «Дальше»; в последнем уроке курса на её месте «К программе». Заголовок «Урок пройден» стоит, когда все упражнения урока решены;
 * иначе и в уроке без упражнений «Конец урока».
 */
export function LessonFinish({
  children,
  actions,
}: {
  readonly children?: ReactNode;
  readonly actions?: LessonFinishActions | undefined;
}) {
  const headingId = useId();
  const solved = useLessonExercisesSolved();
  return (
    <section
      aria-labelledby={headingId}
      className="mt-12 rounded-2xl bg-lesson-surface px-4 pt-5 pb-3 sm:px-6 sm:pt-6"
      data-lesson-finish
    >
      <h2 className="text-lg font-semibold tracking-[-0.01em]" id={headingId}>
        {solved === true ? "Урок пройден" : "Конец урока"}
      </h2>
      <div className="mt-2 divide-y divide-lesson-line empty:hidden">
        {children}
      </div>
      {actions === undefined ? null : (
        <nav
          aria-label="Действия в конце материала"
          className="@container/finish mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-lesson-line pt-3"
          data-material-actions
          data-reader-footer
        >
          <div
            aria-label="Отметка изучения"
            className={`-ml-3 min-w-0 ${styles["study"] ?? ""}`}
            data-reader-study-controls
            role="group"
          >
            {actions.readingAction}
          </div>
          {actions.next === null ? (
            <IntentPrefetchLink
              className={primaryAction}
              data-lesson-finish-programme
              href={actions.programme}
            >
              К программе
            </IntentPrefetchLink>
          ) : (
            <IntentPrefetchLink
              aria-label="Дальше"
              className={primaryAction}
              data-lesson-finish-next
              href={actions.next.href}
              title={actions.next.title}
            >
              Дальше
              <ArrowRight
                aria-hidden="true"
                className="hidden size-4 @[16rem]/finish:block"
              />
            </IntentPrefetchLink>
          )}
        </nav>
      )}
    </section>
  );
}
