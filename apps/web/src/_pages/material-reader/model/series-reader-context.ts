import type { Route } from "next";
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
}: {
  readonly currentMaterialSlug: string;
  readonly returnTarget: MaterialReaderReturnTarget;
  readonly series: SeriesContextSource;
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
  const programme =
    series.chapters === undefined
      ? undefined
      : courseReadingContext({
          series: { ...series, chapters: series.chapters },
          current: { kind: "material", slug: currentMaterialSlug },
          returnTarget,
        });

  return {
    ...(programme === undefined ? {} : { programme }),
    currentPosition: currentIndex + 1,
    next:
      programme?.next ??
      (programme === undefined
        ? toContextItem(series.items[currentIndex + 1], returnTarget.href)
        : null),
    previous:
      programme?.previous ??
      (programme === undefined
        ? toContextItem(series.items[currentIndex - 1], returnTarget.href)
        : null),
    series: {
      hasModeVariants: series.reference.hasModeVariants ?? false,
      href:
        returnTarget.href.split("?")[0] === programmeHref
          ? returnTarget.href
          : programmeHref,
      name: series.reference.name,
    },
    totalMaterials: series.items.length,
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
