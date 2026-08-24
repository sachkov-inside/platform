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
  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
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
        isLiked={isLiked}
        isSaved={isSaved}
        onLikedChange={setIsLiked}
        onReadingStateChange={setReadingState}
        onSavedChange={setIsSaved}
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
          "Skill-oriented guide material. The current fixture keeps the written material central, makes learning outcomes explicit, and leads to a concrete next step.",
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
  name: "Mobile guide material",
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
    await expect(
      canvas.getByRole("heading", { name: "После материала вы сможете" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Найти устойчивый seam")).toBeInTheDocument();
    await expect(
      canvas.queryByRole("navigation", { name: "В этом материале" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("navigation", { name: "Мобильная навигация" }),
    ).toBeInTheDocument();
    const actionGroups = canvas.getAllByRole("group", { name: /Действия с материалом/ });
    const topActionsElement = actionGroups[0];
    const bottomActionsElement = actionGroups[1];

    if (topActionsElement === undefined || bottomActionsElement === undefined) {
      throw new Error("Reader action bars are missing");
    }

    const topActions = within(topActionsElement);
    const bottomActions = within(bottomActionsElement);
    const topActionControls = Array.from(
      topActionsElement.querySelectorAll<HTMLElement>("[data-slot='button']"),
    );
    const firstControl = topActionControls[0];

    if (firstControl === undefined) {
      throw new Error("Reader action controls are missing");
    }

    await expect(actionGroups).toHaveLength(2);
    await expect(topActionsElement.getBoundingClientRect().height).toBeLessThanOrEqual(52);
    await expect(
      Math.max(
        ...topActionControls.map((control) =>
          Math.abs(control.getBoundingClientRect().top - firstControl.getBoundingClientRect().top),
        ),
      ),
    ).toBeLessThanOrEqual(1);
    await expect(topActions.getByRole("button", { name: "Отметить изученным" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await userEvent.click(topActions.getByRole("button", { name: "Сохранить" }));
    await expect(topActions.getByRole("button", { name: "Сохранено" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(bottomActions.getByRole("button", { name: "Сохранено" })).toBeInTheDocument();

    await userEvent.click(topActions.getByRole("button", { name: "Отметить изученным" }));
    await expect(topActions.getByRole("button", { name: "Изучено" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(bottomActions.getByRole("button", { name: "Изучено" })).toBeInTheDocument();

    await userEvent.click(topActions.getByRole("button", { name: "Нравится 58" }));
    await expect(topActions.getByRole("button", { name: "Нравится 59" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(bottomActions.getByRole("button", { name: "Нравится 59" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Следующий шаг" })).toBeInTheDocument();
    await expect(canvas.queryByText("Продолжить чтение")).not.toBeInTheDocument();
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
  name: "Narrow desktop guide material",
  globals: {
    viewport: {
      isRotated: false,
      value: "desktop1209",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const topActions = canvas.getByRole("group", { name: "Действия с материалом в начале" });
    const heading = canvas.getByRole("heading", {
      name: "Публичные skills для agent-first setup",
    });
    const article = canvas.getAllByRole("article")[0];
    const header = heading.closest("header");

    if (article === undefined || header === null) {
      throw new Error("Reader content is missing");
    }

    await expect(heading.getBoundingClientRect().top).toBeGreaterThan(
      topActions.getBoundingClientRect().bottom,
    );
    await expect(topActions.getBoundingClientRect().height).toBeLessThanOrEqual(64);
    await expect(article.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      header.getBoundingClientRect().bottom,
    );
    await expect(
      Math.abs(article.getBoundingClientRect().left - header.getBoundingClientRect().left),
    ).toBeLessThanOrEqual(1);
    await expect(
      canvas.queryByRole("complementary", { name: "Контекст чтения" }),
    ).not.toBeInTheDocument();
  },
};

export const Desktop: Story = {
  name: "Desktop guide material",
  globals: {
    viewport: {
      isRotated: false,
      value: "desktop1440",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const actionGroups = canvas.getAllByRole("group", { name: /Действия с материалом/ });
    const topActions = actionGroups[0];
    const article = canvas.getAllByRole("article")[0];

    if (article === undefined || topActions === undefined) {
      throw new Error("Reader content is missing");
    }

    await expect(actionGroups).toHaveLength(2);
    await expect(topActions.getBoundingClientRect().height).toBeLessThanOrEqual(64);
    await expect(article.getBoundingClientRect().width).toBeLessThanOrEqual(780);
    await expect(
      canvas.queryByRole("navigation", { name: "Мобильная навигация" }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Resources" })).toBeInTheDocument();
    const nextStep = canvas.getByRole("region", { name: "Следующий шаг" });
    const nextStepContent = within(nextStep);

    await expect(nextStepContent.getByText("Следующий материал")).toBeInTheDocument();
    await expect(nextStepContent.getByText("По теме")).toBeInTheDocument();
  },
};
