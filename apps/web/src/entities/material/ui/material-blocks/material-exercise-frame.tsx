import type { MaterialExerciseNumber } from "@inside/material-blocks";
import type { ReactNode } from "react";

/** «Упражнение 2 из 4»; without a known position, just «Упражнение». */
export function exerciseHeading(
  position: MaterialExerciseNumber | undefined,
): string {
  return position === undefined
    ? "Упражнение"
    : `Упражнение ${String(position.number)} из ${String(position.total)}`;
}

/** Address of an exercise inside its lesson: the end-of-lesson summary links to it. */
export function exerciseAnchor(exerciseId: string): string {
  return `exercise-${exerciseId}`;
}

/**
 * Shared frame of every Lesson Exercise: a quiet «Упражнение N из M», the situation and the
 * question, on a dark graphite block (`data-lesson-dark`, owner decision 14.11.2026). `updated`
 * marks a past answer to an older version; `note` is the answer source's line under it.
 */
export function MaterialExerciseFrame({
  exerciseId,
  heading,
  context,
  question,
  kind,
  updated = false,
  note,
  children,
}: {
  readonly exerciseId: string;
  readonly heading: string;
  readonly context?: ReactNode;
  readonly question: ReactNode;
  readonly kind: "quiz" | "match" | "order";
  readonly updated?: boolean;
  readonly note?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section
      id={exerciseAnchor(exerciseId)}
      aria-label={heading}
      data-material-exercise={kind}
      data-lesson-dark
      {...(kind === "quiz" ? { "data-material-quiz": "" } : {})}
      className="my-6 rounded-xl p-4 text-lesson leading-[1.55] sm:my-8 sm:p-6 [&_p]:min-h-0 [&_p]:mt-3 [&_p:first-child]:mt-0"
    >
      <h2
        data-quiz-heading
        className="text-sm font-medium text-muted-foreground"
      >
        {heading}
      </h2>
      {context === undefined ? null : (
        <div className="mt-2 text-muted-foreground" data-exercise-context>
          {context}
        </div>
      )}
      <div
        className="mt-2 font-semibold text-foreground"
        data-exercise-question
      >
        {question}
      </div>
      {updated ? (
        <p
          className="mt-3 rounded-lg bg-card px-3 py-2 text-sm"
          data-exercise-updated
          role="status"
        >
          Упражнение обновлено, ответь ещё раз
        </p>
      ) : null}
      {children}
      {note === undefined ? null : (
        <div className="mt-3 text-sm text-muted-foreground" data-exercise-note>
          {note}
        </div>
      )}
    </section>
  );
}
