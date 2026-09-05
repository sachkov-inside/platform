import type { Route } from "next";

import {
  materialReaderHref,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";

interface SeriesContextMaterial {
  readonly format: string;
  readonly slug: string;
  readonly title: string;
}

interface SeriesContextSource {
  readonly items: readonly SeriesContextMaterial[];
  readonly kind: "ready";
  readonly reference: {
    readonly name: string;
    readonly slug: string;
    readonly summary: string;
  };
}

export interface SeriesReaderContextItem {
  readonly format: string;
  readonly href: Route;
  readonly title: string;
}

export interface SeriesReaderContext {
  readonly currentPosition: number;
  readonly next: SeriesReaderContextItem | null;
  readonly previous: SeriesReaderContextItem | null;
  readonly series: {
    readonly href: Route;
    readonly name: string;
    readonly slug: string;
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

  return {
    currentPosition: currentIndex + 1,
    next: toContextItem(series.items[currentIndex + 1], returnTarget.href),
    previous: toContextItem(series.items[currentIndex - 1], returnTarget.href),
    series: {
      href: returnTarget.href,
      name: series.reference.name,
      slug: series.reference.slug,
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
        format: material.format,
        href: materialReaderHref(material.slug, seriesHref),
        title: material.title,
      };
}
