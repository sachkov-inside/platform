// Accepted prototype direction: bounded Material cards inside a mobile-first Library composition.

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { expect, within } from "storybook/test";

import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";
import { MaterialCard, materialFixtures } from "@/workshop/material-preview.prototype";

const navigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "Библиотека" },
  { href: "/map", icon: "map", label: "Карта" },
] satisfies readonly ApplicationNavigationItem[];

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
      accountLabel="Кирилл"
      currentPath="/library"
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
  title: "Patterns/Content/Material card",
} satisfies Meta<typeof MediaCardBoard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const HybridCatalog: Story = {
  name: "Mixed-format catalog",
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
    await expect(within(guideCard).queryByRole("link", { name: /выпуск/ })).not.toBeInTheDocument();
    await expect(guideCard.getBoundingClientRect().width).toBeLessThan(750);
  },
  render: () => <HybridCatalogBoard />,
};

export const MediaCard: Story = {
  name: "Video material",
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector("article");

    if (card === null) {
      throw new Error("Material card is missing");
    }

    await expect(canvasElement.querySelectorAll("article")).toHaveLength(1);
    await expect(card.getBoundingClientRect().width).toBeLessThan(750);
    await expect(
      within(card).getByRole("link", { name: "Создание Platform Inside · выпуск 5" }),
    ).toHaveAttribute("href", "/series/series-platform-inside");
    await expect(within(card).getByRole("link", { name: "developer pipeline" })).toHaveAttribute(
      "href",
      "/library?query=developer%20pipeline",
    );
  },
};
