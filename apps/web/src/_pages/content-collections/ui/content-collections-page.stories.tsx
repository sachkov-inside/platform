import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { withMutationFetch } from "@/workshop/mutation-mock";

import { ContentCollectionsPageClient } from "./content-collections-page.client";

const collections = [
  {
    archived: false,
    id: "97000000-0000-4000-8000-000000000001",
    kind: "topic",
    materialCount: 8,
    name: "Product engineering",
    slug: "product-engineering",
    summary: "Продуктовые решения, архитектура и поставка.",
    version: 3,
  },
  {
    archived: true,
    id: "97000000-0000-4000-8000-000000000002",
    kind: "topic",
    materialCount: 2,
    name: "Legacy topic",
    slug: "legacy-topic",
    summary: "Существующие ссылки сохранены.",
    version: 2,
  },
] as const;

const meta = {
  args: { initialCollections: collections, kind: "topic" },
  component: ContentCollectionsPageClient,
  decorators: [
    withMutationFetch(() =>
      Promise.resolve(
        Response.json({ kind: "saved", collection: collections[0] }),
      ),
    ),
  ],
  parameters: { nextjs: { appDirectory: true } },
  title: "Pages/Authoring/Коллекции",
} satisfies Meta<typeof ContentCollectionsPageClient>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TopicsDesktop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1, name: "Темы" })).toBeVisible();
    await expect(canvas.getByText("В архиве")).toBeVisible();
    await expect(canvas.getAllByRole("button", { name: "Сохранить metadata" })[0]).toBeDisabled();
  },
};

export const EmptyMobile: Story = {
  args: { initialCollections: [] },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Пока ничего нет")).toBeVisible();
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};
