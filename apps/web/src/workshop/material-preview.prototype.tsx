import {
  BookOpenText,
  LockKeyhole,
  Play,
  Unlock,
} from "lucide-react";

import { cn } from "@/shared/lib/utils";

export type MaterialAccess = "free" | "membership";

export interface MaterialSeriesFixture {
  readonly id: string;
  readonly ordinal: number;
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
        title: "Создание Platform Inside",
      },
    ],
    summary:
      "Разбираем, как связать issue, task branch, evidence, pull request и явный owner GO в один проверяемый delivery flow.",
    tags: ["platform build", "developer pipeline", "harness"],
    title:
      "Создание Platform Inside — 5. Developer Pipeline и owner-controlled delivery",
    topic: "Product engineering",
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
  },
} as const satisfies Readonly<Record<string, MaterialPreviewFixture>>;

export function MaterialCard({
  headingLevel = "h2",
  material,
}: {
  readonly headingLevel?: "h2" | "h3";
  readonly material: MaterialPreviewFixture;
}) {
  const hasPreview = material.format === "Видео";
  const Heading = headingLevel;
  const visibleLabels = [material.topic, ...material.tags.slice(0, 1)];

  return (
    <article className="@container/material-card max-w-[46rem]" data-material-id={material.id}>
      <a
        className={cn(
          "group grid overflow-hidden rounded-xl bg-card shadow-card no-underline transition-[box-shadow,transform] duration-200 motion-reduce:transform-none motion-reduce:transition-none",
          "hover:-translate-y-0.5 hover:shadow-card-hover active:translate-y-0 active:shadow-card focus-visible:outline-ring",
          hasPreview && "@min-[30rem]/material-card:grid-cols-[minmax(13rem,0.9fr)_minmax(0,1.1fr)]",
        )}
        href="#open-material"
      >
        {hasPreview ? <MaterialPoster material={material} /> : null}
        <span className="flex min-w-0 flex-col p-4 @min-[30rem]/material-card:p-6">
          <span className="flex flex-wrap gap-1.5">
            {visibleLabels.map((label, index) => (
              <span
                className={cn(
                  "rounded-md px-2 py-1 text-[0.6875rem] font-semibold leading-4",
                  index === 0
                    ? "bg-accent/10 text-foreground"
                    : "bg-secondary text-secondary-foreground/75",
                )}
                key={label}
              >
                {label}
              </span>
            ))}
          </span>
          <Heading className="mt-3 line-clamp-2 text-base font-semibold leading-[1.3] tracking-[-0.02em] @min-[30rem]/material-card:line-clamp-3 @min-[30rem]/material-card:text-lg">
            {material.title}
          </Heading>
          <span className="mt-2 line-clamp-1 text-sm leading-5 text-muted-foreground @min-[30rem]/material-card:line-clamp-2">
            {material.summary}
          </span>
          <span className="mt-3 flex flex-wrap items-center justify-between gap-2 @min-[30rem]/material-card:mt-auto @min-[30rem]/material-card:pt-4">
            <MaterialContext material={material} />
            <AccessLabel access={material.access} />
          </span>
        </span>
      </a>
    </article>
  );
}

function MaterialContext({ material }: { readonly material: MaterialPreviewFixture }) {
  const FormatIcon = material.format === "Видео" ? Play : BookOpenText;

  return (
    <span className="flex flex-wrap items-center gap-2 font-mono text-[0.6875rem] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <FormatIcon aria-hidden="true" className="size-3.5 text-accent" />
        {material.format}
      </span>
    </span>
  );
}

function AccessLabel({ access }: { readonly access: MaterialAccess }) {
  const Icon = access === "free" ? Unlock : LockKeyhole;
  const label = access === "free" ? "Бесплатно" : "Для участников";

  return (
    <span
      className={cn(
        "inline-flex min-h-7 w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
        access === "free"
          ? "bg-secondary text-secondary-foreground"
          : "bg-primary text-primary-foreground",
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  );
}

function MaterialPoster({ material }: { readonly material: MaterialPreviewFixture }) {
  return (
    <span
      aria-label={material.posterLabel}
      className="relative grid aspect-video min-h-0 place-items-center overflow-clip bg-sidebar p-5 text-sidebar-foreground @min-[30rem]/material-card:aspect-auto @min-[30rem]/material-card:min-h-full"
      role="img"
    >
      <span
        aria-hidden="true"
        className="absolute left-5 top-4 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-sidebar-foreground/55"
      >
        {material.format}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative grid w-full items-center gap-1.5 pt-7 before:absolute before:inset-x-4 before:top-[calc(50%+0.875rem)] before:h-px before:bg-sidebar-primary",
          material.posterSteps.length > 3 ? "grid-cols-5" : "grid-cols-3",
        )}
      >
        {material.posterSteps.map((step) => (
          <span
            className="relative grid min-h-14 min-w-0 place-items-center rounded-lg border border-sidebar-border bg-sidebar-accent px-1 text-center font-mono text-[0.5625rem] leading-4 text-sidebar-accent-foreground sm:text-[0.625rem]"
            key={step}
          >
            {step}
          </span>
        ))}
      </span>
      {material.duration ? (
        <span className="absolute bottom-3 right-3 rounded-md bg-sidebar-foreground px-2 py-1 font-mono text-[0.6875rem] font-semibold tabular-nums text-sidebar">
          {material.duration}
        </span>
      ) : null}
    </span>
  );
}
