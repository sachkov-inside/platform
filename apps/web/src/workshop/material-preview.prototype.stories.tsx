// Accepted prototype direction: bounded Material cards inside a mobile-first Library composition.

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  BookOpenText,
  LockKeyhole,
  Play,
  Unlock,
} from "lucide-react";
import type { ReactNode } from "react";
import { expect, within } from "storybook/test";

import { cn } from "@/shared/lib/utils";
import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";

type MaterialAccess = "free" | "membership";

interface MaterialPreviewFixture {
  readonly access: MaterialAccess;
  readonly duration?: string;
  readonly format: "Гайд" | "Видео";
  readonly posterLabel: string;
  readonly posterSteps: readonly string[];
  readonly summary: string;
  readonly tags: readonly string[];
  readonly title: string;
}

const navigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "Библиотека" },
  { href: "/map", icon: "map", label: "Карта" },
] satisfies readonly ApplicationNavigationItem[];

const materialFixtures = {
  careerVideo: {
    access: "membership",
    duration: "52:18",
    format: "Видео",
    posterLabel: "Карта проверки гипотез при поиске работы",
    posterSteps: ["Гипотеза", "Резюме", "Проверка"],
    summary:
      "Практический разбор воронки поиска, структуры резюме и проверки гипотез без массовых безадресных откликов.",
    tags: ["Резюме", "Поиск работы"],
    title: "Гайд на поиск работы и резюме в IT",
  },
  platformDeliveryVideo: {
    access: "membership",
    duration: "38:42",
    format: "Видео",
    posterLabel: "Пять стадий delivery от ready issue до owner-approved merge",
    posterSteps: ["Issue", "Ветка", "Checks", "PR", "GO"],
    summary:
      "Разбираем, как связать issue, task branch, evidence, pull request и явный owner GO в один проверяемый delivery flow.",
    tags: ["Delivery", "Platform"],
    title:
      "Создание Platform Inside — 5. Developer Pipeline и owner-controlled delivery",
  },
  publicAgentGuide: {
    access: "free",
    format: "Гайд",
    posterLabel: "Маршрут от project rules через skill к проверяемому результату",
    posterSteps: ["Rules", "Skill", "Evidence"],
    summary:
      "Как превратить повторяемый инженерный процесс в короткую repository-owned инструкцию, которую человек и агент выполняют одинаково.",
    tags: ["Skills", "Agents"],
    title: "Публичные skills для agent-first setup",
  },
} as const satisfies Readonly<Record<string, MaterialPreviewFixture>>;

function MaterialCard({ material }: { readonly material: MaterialPreviewFixture }) {
  const hasPreview = material.format === "Видео";

  return (
    <article className="@container/material-card max-w-[46rem]">
      <a
        className={cn(
          "group grid overflow-hidden rounded-xl bg-card shadow-card no-underline transition-[box-shadow,transform] duration-200",
          "hover:-translate-y-0.5 hover:shadow-card-hover active:translate-y-0 active:shadow-card focus-visible:outline-ring",
          hasPreview && "@min-[30rem]/material-card:grid-cols-[minmax(13rem,0.9fr)_minmax(0,1.1fr)]",
        )}
        href="#open-material"
      >
        {hasPreview ? <MaterialPoster material={material} /> : null}
        <span className="flex min-w-0 flex-col p-4 @min-[30rem]/material-card:p-6">
          <span className="flex flex-wrap gap-1.5">
            {material.tags.map((tag, index) => (
              <span
                className={cn(
                  "rounded-md px-2 py-1 text-[0.6875rem] font-semibold leading-4",
                  index === 0
                    ? "bg-accent/10 text-foreground"
                    : "bg-secondary text-secondary-foreground/75",
                )}
                key={tag}
              >
                {tag}
              </span>
            ))}
          </span>
          <h2 className="mt-3 line-clamp-2 text-base font-semibold leading-[1.3] tracking-[-0.02em] @min-[30rem]/material-card:line-clamp-3 @min-[30rem]/material-card:text-lg">
            {material.title}
          </h2>
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

function HybridCatalogBoard() {
  return (
    <WorkshopShell>
      <div data-prototype="material-card-candidate">
        <header className="max-w-3xl">
          <h1 className="text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">
            Библиотека
          </h1>
          <p className="mt-4 max-w-[66ch] text-pretty text-base leading-7 text-muted-foreground">
            Видео с превью и текстовые материалы без искусственных заглушек.
          </p>
        </header>
        <section aria-labelledby="materials-heading" className="mt-9 max-w-5xl">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold tracking-[-0.025em]" id="materials-heading">
              Новые материалы
            </h2>
            <span className="shrink-0 rounded-full bg-secondary px-3 py-1.5 font-mono text-xs text-muted-foreground">
              3 материала
            </span>
          </div>
          <div className="mt-5 grid items-start gap-6 xl:grid-cols-2">
            <MaterialCard material={materialFixtures.platformDeliveryVideo} />
            <MaterialCard material={materialFixtures.publicAgentGuide} />
            <MaterialCard material={materialFixtures.careerVideo} />
          </div>
        </section>
      </div>
    </WorkshopShell>
  );
}

function MediaCardBoard() {
  return (
    <WorkshopShell>
      <div data-prototype="material-card-isolated">
        <header className="max-w-2xl">
          <h1 className="text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">
            Карточка материала
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Один bounded component: preview у video и content-first composition у текста.
          </p>
        </header>
        <div className="mt-9 max-w-[46rem]">
          <MaterialCard material={materialFixtures.platformDeliveryVideo} />
        </div>
      </div>
    </WorkshopShell>
  );
}

function WorkshopShell({ children }: { readonly children: ReactNode }) {
  return (
    <ApplicationShell
      accountAvatarUrl="https://github.com/KirillSachkov.png?size=80"
      accountLabel="Кирилл"
      currentPath="/library"
      layout="sidebar"
      navigationItems={navigationItems}
      sidebarDefaultPinned
    >
      {children}
    </ApplicationShell>
  );
}

const meta = {
  component: MediaCardBoard,
  parameters: {
    docs: {
      description: {
        component:
          "Workshop-only accepted direction: bounded, mobile-first Material cards with optional preview and container-driven enhancement.",
      },
    },
    nextjs: {
      appDirectory: true,
    },
  },
  tags: ["autodocs"],
  title: "Compositions/Material cards",
} satisfies Meta<typeof MediaCardBoard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const HybridCatalog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const account = canvas.queryByRole("group", { name: "Текущий профиль: Кирилл" });
    const sidebar = canvas.queryByRole("complementary", { name: "Боковая панель" });
    const guideHeading = canvas.getByRole("heading", {
      name: materialFixtures.publicAgentGuide.title,
    });
    const guideCard = guideHeading.closest("article");

    await expect(canvasElement.querySelectorAll("article")).toHaveLength(3);
    await expect(canvas.getAllByRole("img")).toHaveLength(2);
    if (account !== null && sidebar !== null) {
      await expect(
        sidebar.getBoundingClientRect().bottom - account.getBoundingClientRect().bottom,
      ).toBeLessThanOrEqual(16);
    }

    if (guideCard === null) {
      throw new Error("Text material card is missing");
    }

    await expect(within(guideCard).queryByRole("img")).not.toBeInTheDocument();
    await expect(guideCard.getBoundingClientRect().width).toBeLessThan(750);
  },
  render: () => <HybridCatalogBoard />,
};

export const MediaCard: Story = {
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector("article");

    if (card === null) {
      throw new Error("Material card is missing");
    }

    await expect(canvasElement.querySelectorAll("article")).toHaveLength(1);
    await expect(card.getBoundingClientRect().width).toBeLessThan(750);
  },
};
