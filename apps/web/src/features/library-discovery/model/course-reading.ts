import type { Route } from "next";
import { internalRoute } from "@/shared/routing/internal-route";
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
  readonly availability: "available" | "locked" | "unavailable";
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
  /** Position in the mixed sequence; zero for a reference opened without an originating step. */
  readonly currentPosition: number;
  readonly totalSteps: number;
  readonly totalMaterials: number;
  readonly hasModeVariants: boolean;
  readonly previous: CourseReadingStep | null;
  readonly next: CourseReadingStep | null;
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
        readonly availability?:
          "available" | "locked" | "unavailable" | undefined;
      }[]
    | undefined;
}

/** Client-safe presentation only: no personal history, tokens or backend DTOs escape this mapping. */
export function courseReadingContext({
  series,
  current,
  returnTarget,
  referenceView = false,
}: {
  readonly series: CourseSource;
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
  const programmeHref = productProgrammeHref(series.reference.slug);
  const href =
    returnTarget?.href.split("?")[0] === programmeHref
      ? returnTarget.href
      : programmeHref;
  const materialReturn = returnTarget?.href ?? href;
  const publishedItems = series.kind === "ready" ? (series.items ?? []) : [];
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
    series.programmePlacements ??
    series.chapters.flatMap((chapter) =>
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
  const chapters = series.chapters.map(
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
          href: productTaskHref(series.reference.slug, task.code),
          availability: task.availability,
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
                ...(series.programmePlacements === undefined
                  ? {}
                  : { placementId: placement.id }),
                href: internalRoute(`${url.pathname}${url.search}`),
                availability: item.availability ?? "available",
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
  const id =
    current.kind === "material"
      ? `material:${current.slug}`
      : `task:${current.code}`;
  const position = referenceView
    ? -1
    : steps.findIndex((step) =>
        current.kind === "material"
          ? step.kind === "material" &&
            (step.id === id || step.id.startsWith(`${id}:`)) &&
            (current.placementId === undefined ||
              step.placementId === current.placementId)
          : step.id === id,
      );
  const reference =
    position >= 0 || current.kind !== "material"
      ? undefined
      : references.find((item) => item.id === `reference:${current.slug}`);
  const referenceItem = publishedItems.find(
    (item) => item.slug === reference?.slug,
  );
  const step =
    steps[position] ??
    (reference === undefined
      ? undefined
      : {
          ...reference,
          kind: "material" as const,
          availability: referenceItem?.availability ?? "available",
        });
  const chapter =
    chapters.find((entry) =>
      entry.steps.some((entryStep) => entryStep.id === steps[position]?.id),
    ) ??
    (reference === undefined
      ? undefined
      : (chapters.find(
          (entry) =>
            entry.references?.some((item) => item.id === reference.id) === true,
        ) ?? chapters[0]));
  if (step === undefined || chapter === undefined) return null;
  return {
    name: series.reference.name,
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
    hasModeVariants: series.reference.hasModeVariants ?? false,
    previous: steps[position - 1] ?? null,
    next: position < 0 ? null : (steps[position + 1] ?? null),
  };
}
