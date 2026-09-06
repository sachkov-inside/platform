import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useEffect } from "react";
import { expect, userEvent, within } from "storybook/test";

import {
  PlaylistPagePrototype,
  TopicPagePrototype,
} from "@/workshop/topic-playlist-pages.prototype";

const meta = {
  component: TopicPagePrototype,
  parameters: {
    docs: {
      description: {
        component:
          "Throwaway Storybook prototype for #208. Topic and Playlist are canonical pages in the same tab; no production routes, queries or schema are changed.",
      },
    },
    nextjs: { appDirectory: true },
  },
  title: "Pages/Knowledge base/Prototype #208",
} satisfies Meta<typeof TopicPagePrototype>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TopicDesktop: Story = {
  args: { scenario: "populated" },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Topic · desktop",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const storyBody = within(canvasElement.ownerDocument.body);
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Продуктовая разработка" }),
    ).toBeVisible();
    await expect(canvas.getByRole("heading", { level: 2, name: "Серии по теме" })).toBeVisible();
    await expect(canvas.getByRole("heading", { level: 2, name: "Материалы" })).toBeVisible();
    await expect(canvasElement.querySelectorAll("[data-playlist-card]")).toHaveLength(3);
    await expect(canvas.queryByText(/без скрытого ограничения/u)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/Серия может продолжаться/u)).not.toBeInTheDocument();

    for (const card of canvasElement.querySelectorAll<HTMLElement>("[data-playlist-card]")) {
      await expect(card.getBoundingClientRect().width).toBeLessThanOrEqual(540);
    }

    const search = canvas.getByRole("searchbox", { name: "Поиск по материалам" });
    await userEvent.type(search, "приёмка");
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(1);
    await userEvent.click(canvas.getByRole("button", { name: "Очистить поиск" }));
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(5);

    const filterButton = canvas.getByRole("button", { name: "Фильтры" });
    await userEvent.click(filterButton);
    const videoFilter = canvas.getByRole("checkbox", { name: "Видео" });
    await userEvent.click(videoFilter);
    await expect(canvasElement.querySelectorAll("article")).toHaveLength(2);
    await userEvent.click(videoFilter);
    await userEvent.click(filterButton);

    const sortControl = canvas.getByRole("combobox", { name: "Сортировка" });
    await userEvent.click(sortControl);
    await userEvent.click(storyBody.getByRole("option", { name: "Сначала видео" }));
    await expect(
      canvasElement.querySelector<HTMLElement>("[data-material-id]"),
    ).toHaveAttribute("data-material-id", "material-delivery-pipeline");

    const guide = canvasElement.querySelector<HTMLElement>(
      '[data-material-id="material-product-boundary"]',
    );
    const video = canvasElement.querySelector<HTMLElement>(
      '[data-material-id="material-delivery-pipeline"]',
    );
    if (guide === null || video === null) {
      throw new Error("Mixed-format Material cards are missing");
    }
    await expect(
      Math.abs(guide.getBoundingClientRect().height - video.getBoundingClientRect().height),
    ).toBeLessThanOrEqual(1);
  },
};

export const TopicMobile: Story = {
  args: { scenario: "populated" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Topic · mobile",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
    const canvas = within(canvasElement);
    const breadcrumb = canvas.getByRole("navigation", { name: "Хлебные крошки" });
    const knowledgeBaseLink = within(breadcrumb).getByRole("link", { name: "База знаний" });
    const firstPlaylist = canvasElement.querySelector<HTMLElement>("[data-playlist-card]");
    if (firstPlaylist === null) {
      throw new Error("Related playlist card is missing");
    }

    await userEvent.tab();
    await expect(canvas.getByRole("link", { name: "Перейти к содержанию" })).toHaveFocus();
    await userEvent.tab();
    await expect(knowledgeBaseLink).toHaveFocus();
    await userEvent.tab();
    await expect(firstPlaylist).toHaveFocus();
    await expect(firstPlaylist.className).toContain("focus-visible:outline-ring");
  },
};

export const TopicSparse: Story = {
  args: { scenario: "sparse" },
  name: "Topic · sparse",
};

export const TopicEmpty: Story = {
  args: { scenario: "empty" },
  name: "Topic · empty",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Серий по теме пока нет")).toBeVisible();
    await expect(canvas.getByText("В теме пока нет материалов")).toBeVisible();
  },
};

export const TopicLongTitle: Story = {
  args: { scenario: "long-title" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Topic · long title",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const PlaylistDesktop: Story = {
  args: { scenario: "populated" },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Playlist · desktop",
  render: (args) => <PlaylistPagePrototype {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Создание Platform Inside" }),
    ).toBeVisible();
    await expect(canvas.getByRole("navigation", { name: "Темы серии" })).toBeVisible();
    await expect(canvas.queryByText(/Серия открывается целиком/u)).not.toBeInTheDocument();
    await expect(
      [...canvasElement.querySelectorAll("[data-playlist-ordinal]")].map((item) =>
        item.getAttribute("data-playlist-ordinal"),
      ),
    ).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    await expect(canvas.getByRole("link", { name: "Инженерия с ИИ" })).toHaveAttribute(
      "href",
      "/topics/ai-engineering",
    );
  },
};

export const PlaylistMobile: Story = {
  args: { scenario: "populated" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Playlist · mobile",
  render: (args) => <PlaylistPagePrototype {...args} />,
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const PlaylistKeyboardAndFocus: Story = {
  args: { scenario: "populated" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Playlist · keyboard and focus",
  render: (args) => <PlaylistPagePrototype {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const breadcrumb = canvas.getByRole("navigation", { name: "Хлебные крошки" });
    const knowledgeBaseLink = within(breadcrumb).getByRole("link", { name: "База знаний" });
    const firstTopic = canvas.getByRole("link", { name: "Продуктовая разработка" });

    await userEvent.tab();
    await expect(canvas.getByRole("link", { name: "Перейти к содержанию" })).toHaveFocus();
    await userEvent.tab();
    await expect(knowledgeBaseLink).toHaveFocus();
    await userEvent.tab();
    await expect(firstTopic).toHaveFocus();
    await expect(firstTopic.className).toContain("focus-visible:outline-ring");
  },
};

export const PlaylistSparse: Story = {
  args: { scenario: "sparse" },
  name: "Playlist · sparse",
  render: (args) => <PlaylistPagePrototype {...args} />,
};

export const PlaylistEmpty: Story = {
  args: { scenario: "empty" },
  name: "Playlist · empty",
  render: (args) => <PlaylistPagePrototype {...args} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Серия пока пуст")).toBeVisible();
  },
};

export const PlaylistLongTitle: Story = {
  args: { scenario: "long-title" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Playlist · long title",
  render: (args) => <PlaylistPagePrototype {...args} />,
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const TextZoom200: Story = {
  args: { scenario: "populated" },
  decorators: [
    (Story) => (
      <TextZoomBoundary>
        <Story />
      </TextZoomBoundary>
    ),
  ],
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Accessibility · 200% text zoom",
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.style.fontSize).toBe("200%");
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const PlaylistTextZoom200: Story = {
  args: { scenario: "populated" },
  decorators: [
    (Story) => (
      <TextZoomBoundary>
        <Story />
      </TextZoomBoundary>
    ),
  ],
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Playlist · 200% text zoom",
  render: (args) => <PlaylistPagePrototype {...args} />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.style.fontSize).toBe("200%");
    await expectNoHorizontalOverflow(canvasElement);
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

async function expectNoHorizontalOverflow(canvasElement: HTMLElement) {
  const view = canvasElement.ownerDocument.defaultView;
  if (view === null) {
    throw new Error("Story window is missing");
  }

  await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
    view.innerWidth,
  );
}
