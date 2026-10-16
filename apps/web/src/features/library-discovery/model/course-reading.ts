import type { Route } from "next";
import { internalRoute } from "@/shared/routing/internal-route";
import { productPath } from "@/shared/routing/public-page-path";
import { placeChapterTasks } from "@/entities/product-task.model";
import { productChapterRuns } from "@/shared/lib/product-chapter-runs";
import {
  materialReaderHref,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import {
  productProgrammeHref,
  productTaskHref,
} from "@/shared/routing/subscription-route";
import { projectReferenceMaterials } from "./project-reference-materials";
import type { ProductChapter } from "./library-discovery-view";

export interface CourseReadingStep {
  readonly id: string;
  readonly title: string;
  readonly href: Route;
  readonly kind: "material" | "task";
  readonly availability: "available" | "locked" | "unavailable";
  readonly materialOrdinal?: number;
  readonly taskOrdinal?: number;
  readonly taskSubmitted?: boolean;
  readonly practiceTaskCode?: string;
}
export interface CourseReadingChapter {
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
  readonly kind: "ready" | "empty";
  readonly reference: {
    readonly slug: string;
    readonly name: string;
    readonly hasModeVariants?: boolean | undefined;
  };
  readonly chapters: readonly Pick<
    ProductChapter,
    "id" | "name" | "materialIds" | "tasks"
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
}: {
  readonly series: CourseSource;
  readonly current:
    | { readonly kind: "material"; readonly slug: string }
    | { readonly kind: "task"; readonly code: string };
  readonly returnTarget?: MaterialReaderReturnTarget;
}): CourseReadingContext | null {
  const programmeHref = productProgrammeHref(series.reference.slug);
  const href =
    returnTarget?.href.split("?")[0] === programmeHref
      ? returnTarget.href
      : programmeHref;
  const materialReturn = returnTarget?.href ?? href;
  const publishedItems = series.kind === "ready" ? (series.items ?? []) : [];
  const chapterByMaterial = new Map(
    series.chapters.flatMap((chapter) =>
      chapter.materialIds.map((id) => [id, chapter.id] as const),
    ),
  );
  const items = publishedItems.filter(
    (item) =>
      item.materialId !== undefined && chapterByMaterial.has(item.materialId),
  );
  const leadingChapters = new Set<string>();
  const chapters = productChapterRuns(items, series.chapters, (item) =>
    item.materialId === undefined
      ? null
      : (chapterByMaterial.get(item.materialId) ?? null),
  ).flatMap((run, index): CourseReadingChapter[] => {
    const chapter = run.chapter;
    if (chapter === null) return [];
    const placed = placeChapterTasks(chapter.tasks ?? [], chapter.materialIds);
    const taskSteps = (tasks: typeof placed.leading): CourseReadingStep[] =>
      tasks.map((task) => ({
        id: `task:${task.code}`,
        kind: "task",
        title: task.title,
        taskSubmitted: task.lastSubmittedAt !== null,
        taskOrdinal:
          (chapter.tasks ?? [])
            .filter((task) => task.programmeVisibility !== "embedded")
            .findIndex((entry) => entry.code === task.code) + 1,
        href: productTaskHref(series.reference.slug, task.code),
        availability: task.availability,
      }));
    const leading = leadingChapters.has(chapter.id)
      ? []
      : taskSteps(placed.leading);
    leadingChapters.add(chapter.id);
    return [
      {
        id: `${chapter.id}:${String(index)}`,
        href: internalRoute(
          `${programmeHref}${run.items[0] === undefined ? "" : `?${new URLSearchParams({ at: run.items[0].slug }).toString()}`}#chapter-${encodeURIComponent(chapter.id)}`,
        ),
        name: chapter.name,
        ordinal:
          series.chapters.findIndex((entry) => entry.id === chapter.id) + 1,
        steps: [
          ...leading,
          ...run.items.flatMap((item, itemIndex): CourseReadingStep[] => [
            {
              id: `material:${item.slug}`,
              kind: "material",
              title: item.title,
              href: materialReaderHref(item.slug, materialReturn),
              availability: item.availability ?? "available",
              materialOrdinal: run.offset + itemIndex + 1,
              ...(() => {
                const practice = chapter.tasks?.find(
                  (task) => task.embeddedMaterialId === item.materialId,
                );
                return practice === undefined
                  ? {}
                  : {
                      practiceTaskCode: practice.code,
                      taskSubmitted: practice.lastSubmittedAt !== null,
                    };
              })(),
            },
            ...taskSteps(
              item.materialId === undefined
                ? []
                : (placed.after.get(item.materialId) ?? []),
            ),
          ]),
        ],
      },
    ];
  });
  const references = projectReferenceMaterials(publishedItems).map((item) => ({
    id: `material:${item.slug}`,
    slug: item.slug,
    title: item.title,
    href: materialReaderHref(item.slug, href),
  }));
  const steps = chapters.flatMap((chapter) => chapter.steps);
  const id =
    current.kind === "material"
      ? `material:${current.slug}`
      : `task:${current.code}`;
  const position = steps.findIndex((step) => step.id === id);
  const reference = references.find((item) => item.id === id);
  const referenceItem = publishedItems.find(
    (item) => `material:${item.slug}` === reference?.id,
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
      entry.steps.some((entryStep) => entryStep.id === id),
    ) ?? (reference === undefined ? undefined : chapters[0]);
  if (step === undefined || chapter === undefined) return null;
  return {
    name: series.reference.name,
    href,
    courseHref: productPath(series.reference.slug),
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
    totalMaterials: items.length,
    hasModeVariants: series.reference.hasModeVariants ?? false,
    previous: steps[position - 1] ?? null,
    next: position < 0 ? null : (steps[position + 1] ?? null),
  };
}
