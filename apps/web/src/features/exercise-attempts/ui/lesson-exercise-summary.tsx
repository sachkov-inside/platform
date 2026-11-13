import { exerciseAnchor } from "@/entities/material";

import type { LessonExercise } from "../model/lesson-exercises";

/**
 * «Упражнения: 3 из 4 решены» at the end of a lesson, with a link to each unsolved exercise.
 * A lesson without exercises shows nothing.
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
  return (
    <section
      aria-label="Упражнения урока"
      className="mt-8 rounded-xl border border-border p-3 text-sm sm:p-4 sm:text-base"
      data-lesson-exercise-summary
    >
      <p className="font-semibold">
        Упражнения: {solved} из {total} решены
      </p>
      {unsolved.length === 0 ? null : (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {unsolved.map((exercise) => (
            <li key={exercise.id}>
              <a
                className="inline-flex min-h-11 items-center text-action underline underline-offset-4"
                href={`#${exerciseAnchor(exercise.id)}`}
              >
                Упражнение {exercise.number}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
