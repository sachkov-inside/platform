import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useEffect } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { KnowledgeBasePrototype } from "@/workshop/knowledge-base-discovery.prototype";

const meta = {
  component: KnowledgeBasePrototype,
  parameters: {
    docs: {
      description: {
        component:
          "Throwaway Storybook prototype for #197. Compare large-card discovery compositions without changing production Library behavior, routes, queries or filters.",
      },
    },
    nextjs: {
      appDirectory: true,
    },
  },
  title: "Pages/Knowledge base/Prototype #197",
} satisfies Meta<typeof KnowledgeBasePrototype>;

export default meta;

type Story = StoryObj<typeof meta>;

export const FeaturedTopic: Story = {
  args: {
    initialVariant: "featured",
    scenario: "populated",
  },
  globals: {
    viewport: {
      isRotated: false,
      value: "desktop1440",
    },
  },
  name: "A · Open topic pages",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const storyBody = within(canvasElement.ownerDocument.body);
    const prototype = canvasElement.querySelector<HTMLElement>("[data-prototype-variant]");

    await expect(canvas.getByRole("heading", { level: 1, name: "База знаний" })).toBeVisible();
    await expect(
      canvasElement.querySelector('a[href="/topics/product-engineering"]'),
    ).toHaveTextContent("Product engineering");
    await expect(
      canvasElement.querySelector('a[href="/series/platform-inside"]'),
    ).toHaveTextContent("Создание Platform Inside");
    await expect(canvas.getByRole("heading", { level: 2, name: "Все материалы" })).toBeVisible();
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(3);
    await expect(prototype).toHaveAttribute("data-prototype-variant", "featured");
    await expect(canvas.queryByText(/Карточки открывают/u)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/порядке, который задал автор/u)).not.toBeInTheDocument();
    for (const topicCard of canvasElement.querySelectorAll<HTMLElement>(
      '[data-topic-card="link"]',
    )) {
      await expect(topicCard.getBoundingClientRect().width).toBeLessThanOrEqual(400);
    }

    const search = canvas.getByRole("searchbox", { name: "Поиск по материалам" });
    await userEvent.type(search, "резюме");
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(1);
    await userEvent.clear(search);
    const filterButton = canvas.getByRole("button", { name: "Фильтры" });
    await userEvent.click(filterButton);
    const aiTopicFilter = canvas.getByRole("checkbox", { name: "AI-first engineering" });
    await userEvent.click(aiTopicFilter);
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(1);
    await userEvent.click(aiTopicFilter);
    await userEvent.click(filterButton);
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(3);
    const sortControl = canvas.getByRole("combobox", { name: "Сортировка" });
    await userEvent.click(sortControl);
    await userEvent.click(storyBody.getByRole("option", { name: "По названию" }));
    await waitFor(async () => {
      await expect(
        canvasElement.ownerDocument.querySelector('[data-aria-hidden="true"]'),
      ).toBeNull();
    });
    await expect(
      canvasElement.querySelector<HTMLElement>("[data-material-id]"),
    ).toHaveAttribute("data-material-id", "material-career-resume");
  },
};

export const EqualTopicFilters: Story = {
  args: {
    initialVariant: "equal",
    scenario: "populated",
  },
  globals: {
    viewport: {
      isRotated: false,
      value: "desktop1440",
    },
  },
  name: "B · Equal cards apply filter",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const topicButton = canvas.getByRole("button", {
      name: "Показать материалы темы AI-first engineering, 9 материалов",
    });

    await userEvent.click(topicButton);
    await expect(topicButton).toHaveAttribute("aria-pressed", "true");
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(1);
    await expect(canvas.getByRole("button", { name: "Сбросить тему: AI-first engineering" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Сбросить тему: AI-first engineering" }));
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(3);
  },
};

export const PlaylistFirst: Story = {
  args: {
    initialVariant: "playlist-first",
    scenario: "populated",
  },
  globals: {
    viewport: {
      isRotated: false,
      value: "desktop1440",
    },
  },
  name: "C · Playlist first",
};

export const Mobile: Story = {
  args: {
    initialVariant: "featured",
    scenario: "populated",
  },
  globals: {
    viewport: {
      isRotated: false,
      value: "mobile390",
    },
  },
  name: "Mobile · open topic pages",
  play: async ({ canvasElement }) => {
    const view = canvasElement.ownerDocument.defaultView;
    if (view === null) {
      throw new Error("Story window is missing");
    }

    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
      view.innerWidth,
    );
    const canvas = within(canvasElement);
    const skipLink = canvas.getByRole("link", { name: "Перейти к содержанию" });
    const firstTopicCard = canvas.getByRole("link", {
      name: /Product engineering Продукт, архитектура/,
    });

    await userEvent.tab();
    await expect(skipLink).toHaveFocus();
    await userEvent.tab();
    await expect(firstTopicCard).toHaveFocus();
    await expect(firstTopicCard.className).toContain("focus-visible:outline-sidebar-ring");
  },
};

export const TextZoom200: Story = {
  args: {
    initialVariant: "featured",
    scenario: "populated",
  },
  decorators: [
    (Story) => (
      <TextZoomBoundary>
        <Story />
      </TextZoomBoundary>
    ),
  ],
  globals: {
    viewport: {
      isRotated: false,
      value: "mobile390",
    },
  },
  name: "Accessibility · 200% text zoom",
  play: async ({ canvasElement }) => {
    const view = canvasElement.ownerDocument.defaultView;
    if (view === null) {
      throw new Error("Story window is missing");
    }

    await expect(canvasElement.ownerDocument.documentElement.style.fontSize).toBe("200%");
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
      view.innerWidth,
    );
  },
};

export const Sparse: Story = {
  args: {
    initialVariant: "featured",
    scenario: "sparse",
  },
  name: "Sparse content",
};

export const Empty: Story = {
  args: {
    initialVariant: "featured",
    scenario: "empty",
  },
  name: "Empty discovery",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Тем пока нет")).toBeVisible();
    await expect(canvas.getByText("Серий пока нет")).toBeVisible();
    await expect(canvas.getByRole("heading", { level: 3, name: "Материалов пока нет" })).toBeVisible();
  },
};

function TextZoomBoundary({ children }: { readonly children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const previousFontSize = root.style.fontSize;
    root.style.fontSize = "200%";

    return () => {
      root.style.fontSize = previousFontSize;
    };
  }, []);

  return children;
}
