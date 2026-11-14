import { exerciseAnchor } from "@/entities/material";

import type { LessonExercise } from "../model/lesson-exercises";

/**
 * «упражнения 0 из 1» in the heading of the lesson finish card: a quiet link to the first unsolved
 * exercise. A screen reader hears «решено 0 из 1 упражнений, перейти к нерешённому».
 */
export function LessonExerciseCount({
  total,
  solved,
  next,
}: {
  readonly total: number;
  readonly solved: number;
  readonly next: LessonExercise;
}) {
  return (
    <a
      className="whitespace-nowrap font-normal text-muted-foreground tabular-nums underline decoration-1 underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      data-lesson-exercise-count
      href={`#${exerciseAnchor(next.id)}`}
    >
      <span aria-hidden="true">
        упражнения {solved} из {total}
      </span>
      <span className="sr-only">
        решено {solved} из {total} упражнений, перейти к нерешённому
      </span>
    </a>
  );
}
