import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { withMutationFetch } from "@/workshop/mutation-mock";

import { ContentCollectionsPageClient } from "./content-collections-page.client";
import { authoringPageEnvironment } from "@/workshop/story-environment";


const collections = [
  {
    archived: false,
    id: "97000000-0000-4000-8000-000000000001",
    introduction: null,
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
    introduction: null,
    kind: "topic",
    materialCount: 2,
    name: "Legacy topic",
    slug: "legacy-topic",
    summary: "Существующие ссылки сохранены.",
    version: 2,
  },
] as const;

const environment = authoringPageEnvironment("/authoring/topics");

const meta = {
  args: { initialCollections: collections, kind: "topic" },
  component: ContentCollectionsPageClient,
  ...environment,
  decorators: [
    withMutationFetch(() =>
      Promise.resolve(
        Response.json({ kind: "saved", collection: collections[0] }),
      ),
    ),
    ...environment.decorators,
  ],
  title: "Pages/Authoring/Коллекции",
} satisfies Meta<typeof ContentCollectionsPageClient>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TopicsDesktop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { level: 1, name: /Темы/u }),
    ).toBeVisible();
    await expect(canvas.getByText(/Архив/u)).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "Сохранить" }),
    ).not.toBeInTheDocument();
  },
};

export const EmptyMobile: Story = {
  args: { initialCollections: [] },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Пока ничего нет"),
    ).toBeVisible();
    await expect(
      canvasElement.ownerDocument.documentElement.scrollWidth,
    ).toBeLessThanOrEqual(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};

export const GuidesMobile: Story = {
  args: {
    initialCollections: collections.map((collection) => ({
      ...collection,
      kind: "series",
    })),
    kind: "series",
  },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", {
      name: "Создать руководство",
    });
    await expect(button).toBeVisible();
    const bounds = button.getBoundingClientRect();
    await expect(bounds.left).toBeGreaterThanOrEqual(0);
    await expect(bounds.right).toBeLessThanOrEqual(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};
