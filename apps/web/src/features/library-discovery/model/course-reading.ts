import type { Route } from "next";
import { internalRoute } from "@/shared/routing/internal-route";
import {
  anchoredMaterialHref,
  parseReaderCourseAnchor,
  type ReaderCourseAnchor,
  materialLinkSlug,
} from "@/shared/routing/reader-course-anchor";
import { placeChapterTasks } from "@/entities/product-task.model";
import {
  materialReaderHref,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import {
  productProgrammeHref,
  productTaskHref,
} from "@/shared/routing/subscription-route";
import {
  resolveCourseNavigation,
  isMaterialStep,
  selectCourseNavigation,
} from "./course-navigation-selection";
import type { ProductChapter } from "./library-discovery-view";

export interface CourseReadingStep {
  readonly id: string;
  readonly title: string;
  readonly href: Route;
  readonly kind: "material" | "task";
  readonly placementId?: string;
  /** Identity of the saved reading mark; only Material steps have one. */
  readonly materialId?: string;
  readonly availability: "available" | "locked" | "unavailable";
  /** Уровень доступа шага, не зависящий от читателя; без него шаг считается открытым. */
  readonly access?: "free" | "closed";
  readonly materialOrdinal?: number;
  readonly taskOrdinal?: number;
  readonly taskSubmitted?: boolean;
  readonly practiceTaskCode?: string;
}
export interface CourseReadingChapter {
  readonly references?: readonly CourseReferenceMaterial[];
  readonly href?: Route;
  readonly id: string;
  readonly name: string;
  readonly ordinal?: number;
  readonly steps: readonly CourseReadingStep[];
}
export interface CourseReferenceMaterial {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly href: Route;
}

export interface CourseReadingContext {
  readonly references?: readonly CourseReferenceMaterial[];
  /** Published membership supplies navigation targets, independently of chapter composition. */
  readonly materialHrefs?: readonly Route[];
  readonly activeReferenceId?: string;
  readonly name: string;
  readonly href: Route;
  readonly courseHref: Route;
  readonly chapters: readonly CourseReadingChapter[];
  readonly current: CourseReadingStep;
  readonly currentChapterId: string;
  /**
   * Position in the mixed sequence; zero for a reference opened without an originating step and for
   * a programme step opened for reference.
   */
  readonly currentPosition: number;
  readonly totalSteps: number;
  readonly totalMaterials: number;
  /**
   * The context was read without the reader's Task submissions; they arrive later through
   * `CourseTaskSubmissionStatuses` and stay unknown until then.
   */
  readonly taskStatusesDeferred?: boolean;
  readonly previous: CourseReadingStep | null;
  readonly next: CourseReadingStep | null;
}

/** Marks a context read from guest-cached composition, whose Task submissions stream in later. */
export function withDeferredTaskStatuses(
  context: CourseReadingContext,
): CourseReadingContext {
  return { ...context, taskStatusesDeferred: true };
}

interface CourseSource {
  readonly programmePlacements?:
    | readonly {
        readonly id: string;
        readonly materialId: string;
        readonly chapterId: string | null;
        readonly stepGroup: string | null;
      }[]
    | undefined;
  readonly kind: "ready" | "empty";
  readonly reference: {
    readonly slug: string;
    readonly name: string;
  };
  readonly chapters: readonly Pick<
    ProductChapter,
    "id" | "name" | "materialIds" | "tasks" | "supplementaryMaterialIds"
  >[];
  readonly items?:
    | readonly {
        readonly slug: string;
        readonly title: string;
        readonly materialId?: string | undefined;
        readonly access?: "free" | "closed" | undefined;
        readonly availability?:
          "available" | "locked" | "unavailable" | undefined;
      }[]
    | undefined;
}

/** Client-safe presentation only: no personal history, tokens or backend DTOs escape this mapping. */
type CourseReadingRequest = {
  readonly product: CourseSource;
  readonly current:
    | {
        readonly kind: "material";
        readonly slug: string;
        readonly placementId?: string | undefined;
      }
    | { readonly kind: "task"; readonly code: string };
  readonly returnTarget?: MaterialReaderReturnTarget;
  readonly referenceView?: boolean;
  readonly anchor?: ReaderCourseAnchor | undefined;
};

export function courseReadingContext(
  request: CourseReadingRequest,
): CourseReadingContext | null {
  return resolveCourseReading(request).programme;
}

/** Includes whether the displayed document is outside the primary sequence, even for an invalid placement. */
export function resolveCourseReading({
  product,
  current,
  returnTarget,
  referenceView = false,
  anchor,
}: CourseReadingRequest): {
  readonly programme: CourseReadingContext | null;
  readonly supplementary: boolean;
} {
  const programmeHref = productProgrammeHref(product.reference.slug);
  const href =
    returnTarget?.href.split("?")[0] === programmeHref
      ? returnTarget.href
      : programmeHref;
  const materialReturn = returnTarget?.href ?? href;
  const publishedItems = product.kind === "ready" ? (product.items ?? []) : [];
  const referenceHref = (slug: string) => {
    const url = new URL(materialReaderHref(slug, href), "https://inside.local");
    url.searchParams.set("view", "reference");
    return internalRoute(`${url.pathname}${url.search}`);
  };
  const references = publishedItems.map((item) => ({
    id: `reference:${item.slug}`,
    slug: item.slug,
    title: item.title,
    href: referenceHref(item.slug),
  }));
  const placements =
    product.programmePlacements ??
    product.chapters.flatMap((chapter) =>
      chapter.materialIds.map((materialId, index) => ({
        id: `${chapter.id}-${String(index)}`,
        materialId,
        chapterId: chapter.id,
        stepGroup: null,
      })),
    );
  const repetitions = new Map<string, number>();
  for (const entry of placements)
    repetitions.set(
      entry.materialId,
      (repetitions.get(entry.materialId) ?? 0) + 1,
    );
  const chapters = product.chapters.map(
    (chapter, index): CourseReadingChapter => {
      const placed = placeChapterTasks(
        chapter.tasks ?? [],
        chapter.materialIds,
      );
      const taskSteps = (tasks: typeof placed.leading): CourseReadingStep[] =>
        tasks.map((task) => ({
          id: `task:${task.code}`,
          kind: "task",
          title: task.title,
          taskSubmitted: task.lastSubmittedAt !== null,
          taskOrdinal:
            (chapter.tasks ?? [])
              .filter((entry) => entry.programmeVisibility !== "embedded")
              .findIndex((entry) => entry.code === task.code) + 1,
          href: productTaskHref(product.reference.slug, task.code),
          availability: task.availability,
          access: task.access,
        }));
      const visited = new Set<string>();
      const chapterPlacements = placements.filter(
        (entry) => entry.chapterId === chapter.id,
      );
      return {
        id: `${chapter.id}:${String(index)}`,
        name: chapter.name,
        ordinal: index + 1,
        href: internalRoute(
          `${programmeHref}#chapter-${encodeURIComponent(chapter.id)}`,
        ),
        references: (chapter.supplementaryMaterialIds ?? []).flatMap((id) => {
          const item = publishedItems.find((entry) => entry.materialId === id);
          const reference = references.find(
            (entry) => entry.slug === item?.slug,
          );
          return reference === undefined ? [] : [reference];
        }),
        steps: [
          ...taskSteps(placed.leading),
          ...chapterPlacements.flatMap((placement): CourseReadingStep[] => {
            const item = publishedItems.find(
              (entry) => entry.materialId === placement.materialId,
            );
            if (item === undefined) return [];
            const repeated = (repetitions.get(placement.materialId) ?? 0) > 1;
            const url = new URL(
              materialReaderHref(item.slug, materialReturn),
              "https://inside.local",
            );
            if (repeated) url.searchParams.set("placement", placement.id);
            const practice = chapter.tasks?.find(
              (task) => task.embeddedMaterialId === item.materialId,
            );
            const first = !visited.has(placement.materialId);
            visited.add(placement.materialId);
            return [
              {
                id: `material:${item.slug}${repeated ? `:${placement.id}` : ""}`,
                kind: "material",
                title: item.title,
                materialId: placement.materialId,
                ...(product.programmePlacements === undefined
                  ? {}
                  : { placementId: placement.id }),
                href: internalRoute(`${url.pathname}${url.search}`),
                availability: item.availability ?? "available",
                ...(item.access === undefined ? {} : { access: item.access }),
                materialOrdinal:
                  placements.findIndex((entry) => entry.id === placement.id) +
                  1,
                ...(practice === undefined
                  ? {}
                  : {
                      practiceTaskCode: practice.code,
                      taskSubmitted: practice.lastSubmittedAt !== null,
                    }),
              },
              ...(first
                ? taskSteps(placed.after.get(placement.materialId) ?? [])
                : []),
            ];
          }),
        ],
      };
    },
  );
  const primary = resolveCourseNavigation({
    chapters,
    references,
    items: publishedItems,
    current,
    referenceView,
  });
  const supplementary =
    referenceView ||
    primary === null ||
    primary.activeReferenceId !== undefined;
  const selection =
    supplementary && anchor !== undefined
      ? resolveCourseNavigation({
          chapters,
          references,
          items: publishedItems,
          current: anchor,
          referenceView: false,
        })
      : primary;
  if (
    selection === null ||
    (supplementary &&
      anchor !== undefined &&
      (selection.current.availability !== "available" ||
        selection.currentPosition === 0))
  )
    return { programme: null, supplementary };
  const context: CourseReadingContext = {
    name: product.reference.name,
    href,
    courseHref: programmeHref,
    chapters,
    references,
    materialHrefs: publishedItems.map((item) =>
      materialReaderHref(item.slug, href),
    ),
    ...selection,
    totalSteps: chapters.reduce(
      (total, chapter) => total + chapter.steps.length,
      0,
    ),
    totalMaterials: new Set(placements.map((entry) => entry.materialId)).size,
  };
  const reference =
    supplementary &&
    anchor !== undefined &&
    primary !== null &&
    current.kind === "material"
      ? references.find((item) => item.slug === current.slug)
      : undefined;
  return {
    programme:
      reference === undefined
        ? context
        : selectCourseNavigation(context, reference.id),
    supplementary,
  };
}

/**
 * A body link to a lesson of this programme opens that lesson as its step, so the chapter steps
 * follow the reader. A repeated Material opens the reader's own placement, else its placement in
 * the reader's chapter. The authored section is kept verbatim. Other links are not programme steps.
 */
export function programmeStepLink(
  context: CourseReadingContext,
  href: string,
): { readonly step: CourseReadingStep; readonly href: Route } | undefined {
  const slug = materialLinkSlug(href);
  if (slug === undefined) return undefined;
  const placements = context.chapters.flatMap((chapter) =>
    chapter.steps
      .filter((step) => isMaterialStep(step, slug))
      .map((step) => ({ chapterId: chapter.id, step })),
  );
  const step = (
    placements.find((entry) => entry.step.id === context.current.id) ??
    placements.find((entry) => entry.chapterId === context.currentChapterId) ??
    placements[0]
  )?.step;
  if (step === undefined) return undefined;
  const fragment = href.indexOf("#");
  return {
    step,
    href: internalRoute(
      fragment < 0 ? step.href : `${step.href}${href.slice(fragment)}`,
    ),
  };
}

/** A programme step opened for reference keeps its chapter label, though it claims no position. */
export function isProgrammeStepOpenedForReference(
  context: CourseReadingContext,
): boolean {
  return (
    context.currentPosition === 0 &&
    context.activeReferenceId === undefined &&
    context.chapters.some((chapter) =>
      chapter.steps.some((step) => step.id === context.current.id),
    )
  );
}

/** The chapter step shown as current; an open supplementary document is current instead. */
export function currentStepId(
  context: CourseReadingContext,
): string | undefined {
  return context.activeReferenceId === undefined
    ? context.current.id
    : undefined;
}

/**
 * The programme step a supplementary document was opened from. Navigation offers it as the way
 * back, while the open document alone is current (owner decision, 2026-11-14).
 */
export function originatingStepId(
  context: CourseReadingContext,
): string | undefined {
  return context.activeReferenceId !== undefined && context.currentPosition > 0
    ? context.current.id
    : undefined;
}

/** Body links choose a programme position before inheriting an originating step as a reference. */
export function courseBodyLinkHref(
  context: CourseReadingContext,
  href: string,
): Route | undefined {
  const step = programmeStepLink(context, href);
  if (step !== undefined) return step.href;
  const anchor =
    context.currentPosition === 0
      ? undefined
      : parseReaderCourseAnchor(context.current.id);
  return anchoredMaterialHref(href, context.href, anchor, true);
}
