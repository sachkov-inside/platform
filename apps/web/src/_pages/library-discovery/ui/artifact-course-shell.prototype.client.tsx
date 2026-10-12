"use client";

import type { ReactNode } from "react";

import { ProductProgrammeFrame } from "@/_pages/library-discovery/ui/product-programme-frame";
import {
  SeriesJourneyControls,
  type JourneyPart,
} from "@/_pages/library-discovery/ui/series-journey-controls.client";
import { MaterialCard, type MaterialPreview } from "@/entities/material";
import { seriesReaderReturnHref } from "@/shared/routing/material-reader";
import {
  productHref,
  productProgrammeHref,
} from "@/shared/routing/subscription-route";

const slug = "inside-ai-engineering";
const currentHref = productProgrammeHref(slug);
const materialTitles = [
  "Как устроен курс",
  "Настройка рабочего окружения",
  "Первый проект с агентом",
];
const materials: readonly MaterialPreview[] = materialTitles.map(
  (title, index) => ({
    slug: `artifact-proof-lesson-${String(index + 1)}`,
    title,
    summary: "Материал для проверки навигации курса в прототипе.",
    access: "free",
    availability: "available",
    format: "Гайд",
    formatSlug: "guide",
    topic: "AI Engineering",
    topicSlug: "ai-engineering",
    tags: [],
    seriesMemberships: [{ name: "AI Engineering", slug, ordinal: index + 1 }],
  }),
);

/** Development-only adapter using the production course frame and navigation. */
export function ArtifactCourseShellProof({
  children,
  count,
}: {
  readonly children: ReactNode;
  readonly count: number;
}) {
  const parts: readonly JourneyPart[] = [
    {
      chapterCount: 0,
      id: "programme",
      kind: "materials",
      label: "Программа",
      runs: [
        {
          chapter: null,
          offset: 0,
          rows: materials.map((material, index) => {
            const ordinal = index + 1;
            const returnHref = seriesReaderReturnHref(
              currentHref,
              1,
              material.slug,
            );
            return {
              available: material.availability === "available",
              card: (
                <MaterialCard
                  headingLevel="h3"
                  material={material}
                  readingStatus={<span />}
                  returnHref={returnHref}
                  seriesOrdinal={ordinal}
                  variant="series"
                />
              ),
              ordinal,
              returnHref,
              slug: material.slug,
            };
          }),
        },
      ],
    },
    {
      accessPending: false,
      entries: materials.map((material) => ({ material, inProgramme: true })),
      id: "supplementary",
      kind: "catalog",
      label: "Материалы",
    },
    {
      count,
      id: "artifacts",
      kind: "artifacts",
      label: "Артефакты",
      panel: children,
    },
  ];
  return (
    <ProductProgrammeFrame
      courseMark
      meta="3 материала · всё открыто"
      name="AI Engineering"
      productHref={productHref(slug)}
      slug={slug}
    >
      <SeriesJourneyControls
        currentHref={currentHref}
        offersAccessRecheck={false}
        parts={parts}
      />
    </ProductProgrammeFrame>
  );
}
