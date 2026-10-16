import type { Route } from "next";
import type { ReaderCourseAnchor } from "@/shared/routing/reader-course-anchor";
import {
  courseReadingContext,
  type CourseReadingContext,
  type ProductChapter,
} from "@/features/library-discovery";
import { productProgrammeHref } from "@/shared/routing/subscription-route";

import {
  materialReaderHref,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";

interface SeriesContextMaterial {
  readonly slug: string;
  readonly title: string;
  readonly materialId?: string | undefined;
  readonly availability?: "available" | "locked" | "unavailable" | undefined;
}

interface SeriesContextSource {
  readonly chapters?: readonly ProductChapter[];
  readonly items: readonly SeriesContextMaterial[];
  readonly kind: "ready";
  readonly reference: {
    readonly hasModeVariants?: boolean | undefined;
    readonly name: string;
    readonly slug: string;
  };
}

export interface SeriesReaderContextItem {
  readonly href: Route;
  readonly title: string;
}

export interface SeriesReaderContext {
  /** Displayed supplementary content stays outside the primary sequence. */
  readonly supplementary?: boolean;
  readonly displayedTitle?: string;
  readonly programme?: CourseReadingContext | null;
  readonly currentPosition: number;
  readonly next: SeriesReaderContextItem | null;
  readonly previous: SeriesReaderContextItem | null;
  readonly series: {
    /** Переключатель режима принадлежит руководству, а не отдельному уроку. */
    readonly hasModeVariants: boolean;
    readonly href: Route;
    readonly name: string;
  };
  readonly totalMaterials: number;
}

export function resolveSeriesReaderContext({
  currentMaterialSlug,
  returnTarget,
  series,
  anchor,
}: {
  readonly currentMaterialSlug: string;
  readonly returnTarget: MaterialReaderReturnTarget;
  readonly series: SeriesContextSource;
  readonly anchor?: ReaderCourseAnchor | undefined;
}): SeriesReaderContext | null {
  if (
    returnTarget.kind !== "series" ||
    returnTarget.seriesSlug === undefined ||
    returnTarget.seriesSlug !== series.reference.slug
  ) {
    return null;
  }

  const currentIndex = series.items.findIndex(
    ({ slug }) => slug === currentMaterialSlug,
  );
  if (currentIndex === -1) return null;
  const programmeHref = productProgrammeHref(series.reference.slug);
  const primaryProgramme =
    series.chapters === undefined || series.chapters.length === 0
      ? undefined
      : courseReadingContext({
          series: { ...series, chapters: series.chapters },
          current: { kind: "material", slug: currentMaterialSlug },
          returnTarget,
        });
  const supplementary =
    primaryProgramme === null ||
    primaryProgramme?.activeReferenceId !== undefined;
  const anchoredProgramme =
    supplementary && anchor !== undefined
      ? courseReadingContext({
          series: { ...series, chapters: series.chapters ?? [] },
          current: anchor,
          returnTarget,
        })
      : primaryProgramme;
  const reference = primaryProgramme?.references?.find(
    (item) => item.id === `material:${currentMaterialSlug}`,
  );
  const programme =
    anchoredProgramme == null || reference === undefined
      ? anchoredProgramme
      : {
          ...anchoredProgramme,
          activeReferenceId: reference.id,
        };
  if (
    programme === null ||
    (supplementary &&
      anchor !== undefined &&
      (programme?.current.availability !== "available" ||
        programme.currentPosition === 0))
  )
    return null;

  return {
    ...(supplementary
      ? {
          supplementary: true,
          displayedTitle:
            series.items[currentIndex]?.title ?? currentMaterialSlug,
        }
      : {}),
    ...(programme === undefined ? {} : { programme }),
    currentPosition:
      programme?.current.materialOrdinal ??
      programme?.currentPosition ??
      currentIndex + 1,
    next: supplementary
      ? null
      : (programme?.next ??
        (programme === undefined
          ? toContextItem(series.items[currentIndex + 1], returnTarget.href)
          : null)),
    previous: supplementary
      ? null
      : (programme?.previous ??
        (programme === undefined
          ? toContextItem(series.items[currentIndex - 1], returnTarget.href)
          : null)),
    series: {
      hasModeVariants: series.reference.hasModeVariants ?? false,
      href:
        returnTarget.href.split("?")[0] === programmeHref
          ? returnTarget.href
          : programmeHref,
      name: series.reference.name,
    },
    totalMaterials: programme?.totalMaterials ?? series.items.length,
  };
}

function toContextItem(
  material: SeriesContextMaterial | undefined,
  seriesHref: Route,
): SeriesReaderContextItem | null {
  return material === undefined
    ? null
    : {
        href: materialReaderHref(material.slug, seriesHref),
        title: material.title,
      };
}
