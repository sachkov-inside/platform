import type { Route } from "next";
import { internalRoute } from "@/shared/routing/internal-route";
import { materialLinkSlug } from "@/shared/routing/reader-course-anchor";
import { placeChapterTasks } from "@/entities/product-task.model";
import {
  materialReaderHref,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import {
  productProgrammeHref,
  productTaskHref,
} from "@/shared/routing/subscription-route";
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
  readonly hasModeVariants: boolean;
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
    readonly hasModeVariants?: boolean | undefined;
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
export function courseReadingContext({
  product,
  current,
  returnTarget,
  referenceView = false,
}: {
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
}): CourseReadingContext | null {
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
  const steps = chapters.flatMap((chapter) => chapter.steps);
  const stepIndex = steps.findIndex((step) =>
    current.kind === "material"
      ? isMaterialStep(step, current.slug) &&
        (current.placementId === undefined ||
          step.placementId === current.placementId)
      : step.id === `task:${current.code}`,
  );
  const position = referenceView ? -1 : stepIndex;
  // A programme step opened for reference stays selected in its chapter without claiming a position;
  // a chapter attachment keeps its attachment row.
  const attached =
    referenceView &&
    current.kind === "material" &&
    chapters.some(
      (chapter) =>
        chapter.references?.some((item) => item.slug === current.slug) === true,
    );
  const programmeStep = attached ? undefined : steps[stepIndex];
  const reference =
    programmeStep !== undefined || current.kind !== "material"
      ? undefined
      : references.find((item) => item.id === `reference:${current.slug}`);
  const referenceItem = publishedItems.find(
    (item) => item.slug === reference?.slug,
  );
  const step =
    programmeStep ??
    (reference === undefined
      ? undefined
      : {
          ...reference,
          kind: "material" as const,
          availability: referenceItem?.availability ?? "available",
        });
  const chapter =
    chapters.find((entry) =>
      entry.steps.some((entryStep) => entryStep.id === programmeStep?.id),
    ) ??
    (reference === undefined
      ? undefined
      : (chapters.find(
          (entry) =>
            entry.references?.some((item) => item.id === reference.id) === true,
        ) ?? chapters[0]));
  if (step === undefined || chapter === undefined) return null;
  return {
    name: product.reference.name,
    href,
    courseHref: programmeHref,
    chapters,
    references,
    materialHrefs: publishedItems.map((item) =>
      materialReaderHref(item.slug, href),
    ),
    ...(reference === undefined ? {} : { activeReferenceId: reference.id }),
    current: step,
    currentChapterId: chapter.id,
    currentPosition: position + 1,
    totalSteps: steps.length,
    totalMaterials: new Set(placements.map((entry) => entry.materialId)).size,
    hasModeVariants: product.reference.hasModeVariants ?? false,
    previous: steps[position - 1] ?? null,
    next: position < 0 ? null : (steps[position + 1] ?? null),
  };
}

/** Every placement of a Material in the programme is one of its steps. */
function isMaterialStep(step: CourseReadingStep, slug: string): boolean {
  return (
    step.kind === "material" &&
    (step.id === `material:${slug}` || step.id.startsWith(`material:${slug}:`))
  );
}

/**
 * A body link to a lesson of this programme opens that lesson as its step, so the chapter steps
 * follow the reader. A repeated Material opens the reader's own placement, else its placement in the
 * reader's chapter. The authored
 * section is kept verbatim. Other links are not programme steps.
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
