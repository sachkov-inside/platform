import {
  BookOpenText,
  ListVideo,
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

export interface MaterialCardProps {
  /** Match the heading level to the surrounding page outline. */
  readonly headingLevel?: "h2" | "h3";
  readonly material: MaterialPreviewFixture;
}

/** Responsive material summary whose media region exists only when the material has real media. */
export function MaterialCard({
  headingLevel = "h2",
  material,
}: MaterialCardProps) {
  const hasPreview = material.format === "Видео";
  const Heading = headingLevel;

  return (
    <article
      className={cn(
        "@container/material-card w-full max-w-[24rem]",
        hasPreview ? "h-full" : "self-start",
      )}
      data-material-id={material.id}
    >
      <div
        className={cn(
          "group/card grid overflow-hidden rounded-xl bg-card shadow-card transition-[box-shadow,transform] duration-200 motion-reduce:transform-none motion-reduce:transition-none",
          "hover:-translate-y-0.5 hover:shadow-card-hover focus-within:outline-ring active:translate-y-0 active:shadow-card",
          hasPreview && "h-full",
        )}
      >
        {hasPreview ? (
          <a
            aria-label={`Открыть материал: ${material.title}`}
            className="min-w-0 no-underline focus-visible:outline-ring"
            href={`/library/${material.id}`}
          >
            <MaterialPoster material={material} />
          </a>
        ) : null}
        <div
          className={cn(
            "flex min-w-0 flex-col p-4",
            hasPreview && "min-h-[12.5rem]",
          )}
        >
          <MaterialTaxonomy material={material} />
          <Heading className="mt-3 line-clamp-2 text-base font-semibold leading-[1.3] tracking-[-0.02em]">
            <a
              className="no-underline hover:underline hover:decoration-accent hover:underline-offset-4 focus-visible:outline-ring"
              href={`/library/${material.id}`}
            >
              {material.title}
            </a>
          </Heading>
          <p
            className={cn(
              "mt-2 text-sm leading-5 text-muted-foreground",
              hasPreview ? "line-clamp-1" : "line-clamp-2",
            )}
          >
            {material.summary}
          </p>
          <div
            className={cn(
              "flex flex-wrap items-end justify-between gap-2",
              hasPreview ? "mt-auto pt-3" : "mt-3",
            )}
          >
            <MaterialContext material={material} />
            <AccessLabel access={material.access} />
          </div>
        </div>
      </div>
    </article>
  );
}

function MaterialTaxonomy({ material }: { readonly material: MaterialPreviewFixture }) {
  return (
    <ul aria-label="Контекст материала" className="flex flex-wrap gap-1.5" role="list">
      <li>
        <a
          className="inline-flex min-h-7 items-center rounded-md bg-accent/10 px-2 py-1 text-[0.6875rem] font-semibold leading-4 text-foreground no-underline hover:bg-accent/15 focus-visible:outline-ring"
          href={`/library?topic=${encodeURIComponent(material.topic)}`}
        >
          {material.topic}
        </a>
      </li>
      {material.tags.slice(0, 2).map((tag) => (
        <li key={tag}>
          <a
            className="inline-flex min-h-7 items-center rounded-md bg-secondary px-2 py-1 text-[0.6875rem] font-semibold leading-4 text-secondary-foreground/75 no-underline hover:text-secondary-foreground focus-visible:outline-ring"
            href={`/library?query=${encodeURIComponent(tag)}`}
          >
            {tag}
          </a>
        </li>
      ))}
    </ul>
  );
}

function MaterialContext({ material }: { readonly material: MaterialPreviewFixture }) {
  const FormatIcon = material.format === "Видео" ? Play : BookOpenText;

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[0.6875rem] text-muted-foreground">
      <span className="inline-flex shrink-0 items-center gap-1.5">
        <FormatIcon aria-hidden="true" className="size-3.5 text-accent" />
        {material.format}
      </span>
      {material.series.map((membership) => (
        <a
          className="inline-flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md pr-1 no-underline hover:text-foreground focus-visible:outline-ring"
          href={`/series/${membership.id}`}
          key={membership.id}
        >
          <ListVideo aria-hidden="true" className="size-3.5 shrink-0 text-accent" />
          <span className="min-w-0 truncate">
            {membership.title} · выпуск {membership.ordinal}
          </span>
        </a>
      ))}
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
      className="relative grid aspect-video min-h-0 place-items-center overflow-clip bg-sidebar p-4 text-sidebar-foreground"
      role="img"
    >
      <span
        aria-hidden="true"
        className="absolute left-4 top-3 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-sidebar-foreground/55"
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
            className="relative grid min-h-12 min-w-0 place-items-center rounded-lg border border-sidebar-border bg-sidebar-accent px-1 text-center font-mono text-[0.5625rem] leading-4 text-sidebar-accent-foreground sm:text-[0.625rem]"
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
