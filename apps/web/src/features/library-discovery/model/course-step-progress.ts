import type { CourseReadingStep } from "./course-reading";

export type CourseStepProgress = "done" | "todo" | "unknown";

/** Saved reading marks of one Account; `null` when the reader has no personal progress to show. */
export type CourseReadMarks = ReadonlyMap<
  string,
  { readonly isRead: boolean }
> | null;

/** A step is passed by its own saved mark or submission, never by its position in the chapter. */
export function courseStepProgress(
  step: CourseReadingStep,
  marks: CourseReadMarks,
): CourseStepProgress {
  // A saved submission is known on its own; reading marks may still be absent.
  if (step.taskSubmitted === true) return "done";
  if (marks === null) return "unknown";
  if (step.kind === "task") return "todo";
  const mark =
    step.materialId === undefined ? undefined : marks.get(step.materialId);
  if (mark === undefined) return "unknown";
  return mark.isRead ? "done" : "todo";
}

/** Counts rows as the reader sees them; an unknown row withholds the summary instead of guessing. */
export function courseChapterProgress(
  steps: readonly CourseReadingStep[],
  marks: CourseReadMarks,
): { readonly done: number; readonly total: number } | null {
  if (steps.length === 0) return null;
  let done = 0;
  for (const step of steps) {
    const progress = courseStepProgress(step, marks);
    if (progress === "unknown") return null;
    if (progress === "done") done += 1;
  }
  return { done, total: steps.length };
}
