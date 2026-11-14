import { Check } from "lucide-react";

import { exerciseAnchor } from "@/entities/material";
import { cn } from "@/shared/lib/utils";

import type { LessonExercise } from "../model/lesson-exercises";

/**
 * «Упражнения: 3 из 4 решены» at the end of a lesson: one row with a marker per exercise, solved
 * ones ticked, and a link to the first unsolved exercise. A lesson without exercises shows nothing.
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
    <section
      aria-label="Упражнения урока"
      className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border border-lesson-line bg-lesson-surface px-4 py-2 sm:px-6"
      data-lesson-exercise-summary
    >
      <div className="flex min-h-11 min-w-0 items-center gap-3">
        <span aria-hidden="true" className="flex flex-wrap gap-1">
          {Array.from({ length: total }, (_, place) => {
            const done = !open.has(place + 1);
            return (
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-md",
                  done
                    ? "bg-lesson-graphite text-lesson-graphite-foreground"
                    : "border border-lesson-line bg-card",
                )}
                data-lesson-exercise-marker={done ? "solved" : "open"}
                key={place}
              >
                {done ? <Check className="size-3.5" /> : null}
              </span>
            );
          })}
        </span>
        <p className="font-semibold">
          Упражнения: {solved} из {total} решены
        </p>
      </div>
      {next === undefined ? null : (
        <a
          className="inline-flex min-h-11 items-center text-sm font-medium text-lesson-ink underline underline-offset-4 hover:text-foreground"
          href={`#${exerciseAnchor(next.id)}`}
        >
          Решить упражнение {next.number}
        </a>
      )}
    </section>
  );
}
