import type { CourseReadingContext } from "./course-reading";

/** Optimistic navigation changes presentation only; authoritative progress remains untouched. */
export function selectCourseNavigation(
  context: CourseReadingContext,
  selectedId: string | null,
): CourseReadingContext {
  if (selectedId === null) return context;
  const reference = context.references?.find((item) => item.id === selectedId);
  if (reference !== undefined)
    return { ...context, activeReferenceId: reference.id };
  const steps = context.chapters.flatMap((chapter) => chapter.steps);
  const index = steps.findIndex((step) => step.id === selectedId);
  const current = steps[index];
  const chapter = context.chapters.find((item) =>
    item.steps.some((step) => step.id === selectedId),
  );
  if (current === undefined || chapter === undefined) return context;
  const navigation = {
    ...context,
    current,
    currentChapterId: chapter.id,
    currentPosition: index + 1,
    previous: steps[index - 1] ?? null,
    next: steps[index + 1] ?? null,
  };
  delete navigation.activeReferenceId;
  return navigation;
}

export interface CourseNavigationIntent {
  readonly id: string;
  readonly courseHref: string;
}

/** A late source-page update must not cancel a click whose destination is still loading. */
export function reconcileCourseNavigation(
  intent: CourseNavigationIntent | null,
  context: CourseReadingContext | null,
): CourseNavigationIntent | null {
  return intent === null ||
    context === null ||
    context.courseHref !== intent.courseHref ||
    (context.activeReferenceId === undefined &&
      (context.current.id === intent.id ||
        opensProgrammeStepForReference(intent.id, context))) ||
    context.activeReferenceId === intent.id
    ? null
    : intent;
}

/** A programme lesson opened for reference replaces its reference row with its own step. */
function opensProgrammeStepForReference(
  id: string,
  context: CourseReadingContext,
): boolean {
  if (!id.startsWith("reference:") || context.currentPosition !== 0)
    return false;
  const step = `material:${id.slice("reference:".length)}`;
  return (
    context.current.id === step || context.current.id.startsWith(`${step}:`)
  );
}
