import { exerciseAnchor } from "@/entities/material";
import { cn } from "@/shared/lib/utils";

import type { LessonExercise } from "../model/lesson-exercises";

/**
 * «Упражнения: 3 из 4» in the lesson finish card: one quiet row with a dot per exercise, solved
 * ones filled, and a link to the first unsolved exercise. A lesson without exercises shows nothing.
 */
export function LessonExerciseSummary({
  total,
  solved,
  unsolved,
}: {
  readonly total: number;
  readonly solved: number;
  readonly unsolved: readonly LessonExercise[];
}) {
  if (total === 0) return null;
  const open = new Set(unsolved.map((exercise) => exercise.number));
  const next = unsolved.reduce<LessonExercise | undefined>(
    (first, exercise) =>
      first === undefined || exercise.number < first.number ? exercise : first,
    undefined,
  );
  return (
    <div
      className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 py-1"
      data-lesson-exercise-summary
    >
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="flex max-w-32 flex-wrap gap-1">
          {Array.from({ length: total }, (_, place) => {
            const done = !open.has(place + 1);
            return (
              <span
                className={cn(
                  "size-2 rounded-full",
                  done ? "bg-lesson-graphite" : "bg-lesson-line",
                )}
                data-lesson-exercise-marker={done ? "solved" : "open"}
                key={place}
              />
            );
          })}
        </span>
        <p className="tabular-nums">
          Упражнения: {solved} из {total}
          <span className="sr-only"> решены</span>
        </p>
      </div>
      {next === undefined ? null : (
        <a
          className="inline-flex min-h-11 items-center text-sm text-lesson-ink underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          href={`#${exerciseAnchor(next.id)}`}
        >
          Решить упражнение {next.number}
        </a>
      )}
    </div>
  );
}
