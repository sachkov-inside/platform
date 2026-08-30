import type { ComponentProps } from "react";

import {
  MaterialCard as ProductionMaterialCard,
  type MaterialPreview,
} from "@/entities/material";

export type MaterialAccess = MaterialPreview["access"];

export interface MaterialSeriesFixture {
  readonly id: string;
  readonly ordinal: number;
  readonly slug: string;
  readonly title: string;
}

export interface MaterialPreviewFixture {
  readonly access: MaterialAccess;
  readonly duration?: string;
  readonly format: "Гайд" | "Видео";
  readonly id: string;
  readonly posterLabel: string;
  readonly posterSteps: readonly string[];
  readonly series: readonly MaterialSeriesFixture[];
  readonly summary: string;
  readonly tags: readonly string[];
  readonly title: string;
  readonly topic: string;
  readonly topicSlug: string;
}

export const materialFixtures = {
  careerVideo: {
    access: "membership",
    duration: "52:18",
    format: "Видео",
    id: "material-career-resume",
    posterLabel: "Карта проверки гипотез при поиске работы",
    posterSteps: ["Гипотеза", "Резюме", "Проверка"],
    series: [],
    summary:
      "Практический разбор воронки поиска, структуры резюме и проверки гипотез без массовых безадресных откликов.",
    tags: ["job search", "resume"],
    title: "Гайд на поиск работы и резюме в IT",
    topic: "Карьера",
    topicSlug: "career",
  },
  platformDeliveryVideo: {
    access: "membership",
    duration: "38:42",
    format: "Видео",
    id: "material-platform-build-05",
    posterLabel: "Пять стадий delivery от ready issue до owner-approved merge",
    posterSteps: ["Issue", "Ветка", "Checks", "PR", "GO"],
    series: [
      {
        id: "series-platform-inside",
        ordinal: 5,
        slug: "platform-inside",
        title: "Создание Platform Inside",
      },
    ],
    summary:
      "Разбираем, как связать issue, task branch, evidence, pull request и явный owner GO в один проверяемый delivery flow.",
    tags: ["platform build", "developer pipeline", "harness"],
    title:
      "Создание Platform Inside — 5. Developer Pipeline и owner-controlled delivery",
    topic: "Product engineering",
    topicSlug: "product-engineering",
  },
  publicAgentGuide: {
    access: "free",
    format: "Гайд",
    id: "material-public-agent-skills",
    posterLabel: "Маршрут от project rules через skill к проверяемому результату",
    posterSteps: ["Rules", "Skill", "Evidence"],
    series: [],
    summary:
      "Как превратить повторяемый инженерный процесс в короткую repository-owned инструкцию, которую человек и агент выполняют одинаково.",
    tags: ["agent skills", "harness", "engineering workflow"],
    title: "Публичные skills для agent-first setup",
    topic: "AI-first engineering",
    topicSlug: "ai-first-engineering",
  },
} as const satisfies Readonly<Record<string, MaterialPreviewFixture>>;

export interface MaterialCardProps {
  readonly headingLevel?: ComponentProps<typeof ProductionMaterialCard>["headingLevel"];
  readonly material: MaterialPreviewFixture;
}

/** Story fixture adapter over the production-owned MaterialCard implementation. */
export function MaterialCard({ headingLevel, material }: MaterialCardProps) {
  const presentation: MaterialPreview = {
    access: material.access,
    availability: material.access === "free" ? "available" : "locked",
    format: material.format,
    slug: material.id,
    summary: material.summary,
    tags: material.tags,
    title: material.title,
    topic: material.topic,
    topicSlug: material.topicSlug,
    seriesMemberships: material.series.map(({ ordinal, slug, title }) => ({
      name: title,
      ordinal,
      slug,
    })),
    ...(material.format === "Видео"
      ? {
          preview: {
            ...(material.duration === undefined ? {} : { duration: material.duration }),
            label: material.posterLabel,
            steps: material.posterSteps,
          },
        }
      : {}),
  };

  return (
    <ProductionMaterialCard
      {...(headingLevel === undefined ? {} : { headingLevel })}
      material={presentation}
    />
  );
}
