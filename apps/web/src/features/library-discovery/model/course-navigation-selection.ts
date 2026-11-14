import type {
  CourseReadingContext,
  CourseReadingStep,
  CourseReadingChapter,
  CourseReferenceMaterial,
} from "./course-reading";

/** Optimistic navigation changes presentation only; authoritative progress remains untouched. */
export function selectCourseNavigation(
  context: CourseReadingContext,
  selectedId: string | null,
): CourseReadingContext {
  if (selectedId === null) return context;
  const reference = context.references?.find((item) => item.id === selectedId);
  if (reference !== undefined)
    return { ...context, activeReferenceId: reference.id };
  const selection = programmeSelection(context.chapters, selectedId);
  if (selection === null) return context;
  const { activeReferenceId: _reference, ...base } = context;
  return { ...base, ...selection };
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
  const reference = context.references?.find((item) => item.id === id);
  return (
    reference !== undefined &&
    context.currentPosition === 0 &&
    materialPath(reference.href) === materialPath(context.current.href)
  );
}

function materialPath(href: string): string {
  return new URL(href, "https://inside.local").pathname;
}

type CourseSelection = Pick<
  CourseReadingContext,
  | "current"
  | "currentChapterId"
  | "currentPosition"
  | "previous"
  | "next"
  | "activeReferenceId"
>;

/** Server and optimistic browser navigation derive programme positions from the same sequence. */
function programmeSelection(
  chapters: readonly CourseReadingChapter[],
  stepId: string,
  referenceView = false,
): CourseSelection | null {
  const steps = chapters.flatMap((chapter) => chapter.steps);
  const index = steps.findIndex((step) => step.id === stepId);
  const current = steps[index];
  const chapter = chapters.find((entry) =>
    entry.steps.some((step) => step.id === stepId),
  );
  if (current === undefined || chapter === undefined) return null;
  const position = referenceView ? -1 : index;
  return {
    current,
    currentChapterId: chapter.id,
    currentPosition: position + 1,
    previous: steps[position - 1] ?? null,
    next: position < 0 ? null : (steps[position + 1] ?? null),
  };
}

/** A reference selects its attachment row, or its programme step when it is not an attachment. */
export function resolveCourseNavigation({
  chapters,
  references,
  items,
  current,
  referenceView,
}: {
  readonly chapters: readonly CourseReadingChapter[];
  readonly references: readonly CourseReferenceMaterial[];
  readonly items: readonly {
    readonly slug: string;
    readonly availability?: "available" | "locked" | "unavailable" | undefined;
  }[];
  readonly current:
    | {
        readonly kind: "material";
        readonly slug: string;
        readonly placementId?: string | undefined;
      }
    | { readonly kind: "task"; readonly code: string };
  readonly referenceView: boolean;
}): CourseSelection | null {
  const attached =
    referenceView &&
    current.kind === "material" &&
    chapters.some(
      (chapter) =>
        chapter.references?.some((item) => item.slug === current.slug) === true,
    );
  const step = attached
    ? undefined
    : chapters
        .flatMap((chapter) => chapter.steps)
        .find((entry) =>
          current.kind === "task"
            ? entry.id === `task:${current.code}`
            : isMaterialStep(entry, current.slug) &&
              (current.placementId === undefined ||
                entry.placementId === current.placementId),
        );
  if (step !== undefined)
    return programmeSelection(chapters, step.id, referenceView);
  const reference =
    current.kind === "material"
      ? references.find((item) => item.id === `reference:${current.slug}`)
      : undefined;
  const chapter =
    reference === undefined
      ? undefined
      : (chapters.find(
          (entry) =>
            entry.references?.some((item) => item.id === reference.id) === true,
        ) ?? chapters[0]);
  if (reference === undefined || chapter === undefined) return null;
  return {
    current: {
      ...reference,
      kind: "material",
      availability:
        items.find((item) => item.slug === reference.slug)?.availability ??
        "available",
    },
    currentChapterId: chapter.id,
    activeReferenceId: reference.id,
    currentPosition: 0,
    previous: null,
    next: null,
  };
}

/** Every placement of a Material in the programme is one of its steps. */
export function isMaterialStep(step: CourseReadingStep, slug: string): boolean {
  return (
    step.kind === "material" &&
    (step.id === `material:${slug}` || step.id.startsWith(`material:${slug}:`))
  );
}
