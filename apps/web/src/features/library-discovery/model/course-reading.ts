import type { Route } from "next";
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
import type { ProductChapter } from "./library-discovery-view";

export interface CourseReadingStep {
  readonly id: string;
  readonly title: string;
  readonly href: Route;
  readonly kind: "material" | "task";
  readonly availability: "available" | "locked" | "unavailable";
  readonly materialOrdinal?: number;
}
export interface CourseReadingChapter {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly CourseReadingStep[];
}
export interface CourseReadingContext {
  readonly name: string;
  readonly href: Route;
  readonly chapters: readonly CourseReadingChapter[];
  readonly current: CourseReadingStep;
  readonly currentChapterId: string;
  /** Position in the displayed mixed sequence; never a stored Material ordinal. */
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
  const href = productProgrammeHref(series.reference.slug);
  const materialReturn = returnTarget?.href ?? href;
  const items = series.kind === "ready" ? (series.items ?? []) : [];
  const chapterByMaterial = new Map(
    series.chapters.flatMap((chapter) =>
      chapter.materialIds.map((id) => [id, chapter.id] as const),
    ),
  );
  const leadingChapters = new Set<string>();
  const chapters = productChapterRuns(items, series.chapters, (item) =>
    item.materialId === undefined
      ? null
      : (chapterByMaterial.get(item.materialId) ?? null),
  ).map((run, index): CourseReadingChapter => {
    const placed = placeChapterTasks(
      run.chapter?.tasks ?? [],
      run.chapter?.materialIds ?? [],
    );
    const taskSteps = (tasks: typeof placed.leading): CourseReadingStep[] =>
      tasks.map((task) => ({
        id: `task:${task.code}`,
        kind: "task",
        title: task.title,
        href: productTaskHref(series.reference.slug, task.code),
        availability: task.availability,
      }));
    const leading =
      run.chapter === null || leadingChapters.has(run.chapter.id)
        ? []
        : taskSteps(placed.leading);
    if (run.chapter !== null) leadingChapters.add(run.chapter.id);
    return {
      id: `${run.chapter?.id ?? "materials"}:${String(index)}`,
      name: run.chapter?.name ?? "Материалы",
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
          },
          ...taskSteps(
            item.materialId === undefined
              ? []
              : (placed.after.get(item.materialId) ?? []),
          ),
        ]),
      ],
    };
  });
  const steps = chapters.flatMap((chapter) => chapter.steps);
  const id =
    current.kind === "material"
      ? `material:${current.slug}`
      : `task:${current.code}`;
  const position = steps.findIndex((step) => step.id === id);
  const step = steps[position];
  const chapter = chapters.find((entry) =>
    entry.steps.some((entryStep) => entryStep.id === id),
  );
  if (step === undefined || chapter === undefined) return null;
  return {
    name: series.reference.name,
    href,
    chapters,
    current: step,
    currentChapterId: chapter.id,
    currentPosition: position + 1,
    totalSteps: steps.length,
    totalMaterials: items.length,
    hasModeVariants: series.reference.hasModeVariants ?? false,
    previous: steps[position - 1] ?? null,
    next: steps[position + 1] ?? null,
  };
}
