"use client";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";
import {
  longFormMaterialFixture,
  MaterialReader,
  type ReadingState,
} from "@/workshop/material-reader.prototype";

const navigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "Библиотека" },
  { href: "/map", icon: "map", label: "Карта" },
] satisfies readonly ApplicationNavigationItem[];

function MaterialReaderBoard() {
  const [readingState, setReadingState] = useState<ReadingState>("unread");

  return (
    <ApplicationShell
      accountAvatarUrl="https://github.com/KirillSachkov.png?size=80"
      accountLabel="Кирилл"
      currentPath="/library/material-public-agent-skills"
      layout="sidebar"
      navigationItems={navigationItems}
      sidebarDefaultPinned
    >
      <MaterialReader
        fixture={longFormMaterialFixture}
        onReadingStateChange={setReadingState}
        readingState={readingState}
      />
    </ApplicationShell>
  );
}

const meta = {
  component: MaterialReaderBoard,
  parameters: {
    docs: {
      description: {
        component:
          "Owner-controlled mobile-first long-form Material proof. It keeps one reading order across viewports and leaves persistent mobile bottom navigation as an explicit owner decision.",
      },
    },
    nextjs: {
      appDirectory: true,
    },
  },
  title: "Pages/Material/Reader",
} satisfies Meta<typeof MaterialReaderBoard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Mobile: Story = {
  name: "Mobile long-form reading",
  globals: {
    viewport: {
      isRotated: false,
      value: "mobile320",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const storyWindow = canvasElement.ownerDocument.defaultView;

    await expect(
      canvas.getByRole("heading", { name: "Публичные skills для agent-first setup" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("navigation", { name: "В этом материале" })).toBeInTheDocument();
    await expect(
      canvas.getByRole("navigation", { name: "Мобильная навигация" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Отметить прочитанным" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await userEvent.click(canvas.getByRole("button", { name: "Отметить прочитанным" }));
    await expect(canvas.getByText("Материал прочитан")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Отметить непрочитанным" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.getByRole("region", { name: "Сравнение признаков skill contract" })).toBeInTheDocument();
    await expect(canvas.getAllByRole("article")).toHaveLength(3);

    if (storyWindow === null) {
      throw new Error("Story window is unavailable");
    }

    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
      storyWindow.innerWidth + 1,
    );
    storyWindow.scrollTo({ left: 0, top: 0 });
  },
};

export const NarrowDesktop: Story = {
  name: "Narrow desktop reading",
  globals: {
    viewport: {
      isRotated: false,
      value: "desktop1209",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const context = canvas.getByRole("complementary", { name: "Контекст чтения" });
    const heading = canvas.getByRole("heading", {
      name: "Публичные skills для agent-first setup",
    });
    const article = canvas.getAllByRole("article")[0];

    if (article === undefined) {
      throw new Error("Reader article is missing");
    }

    await expect(context.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      heading.getBoundingClientRect().bottom,
    );
    await expect(article.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      context.getBoundingClientRect().bottom,
    );
  },
};

export const Desktop: Story = {
  name: "Desktop long-form reading",
  globals: {
    viewport: {
      isRotated: false,
      value: "desktop1440",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const context = canvas.getByRole("complementary", { name: "Контекст чтения" });
    const article = canvas.getAllByRole("article")[0];

    if (article === undefined) {
      throw new Error("Reader article is missing");
    }

    await expect(context.getBoundingClientRect().left).toBeGreaterThan(
      article.getBoundingClientRect().right,
    );
    await expect(article.getBoundingClientRect().width).toBeLessThanOrEqual(720);
    await expect(
      canvas.queryByRole("navigation", { name: "Мобильная навигация" }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Resources" })).toBeInTheDocument();
  },
};
