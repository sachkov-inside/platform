import {
  AutosaveActivity,
  autosaveWhileHidden,
} from "@/storybook/autosave-activity";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import {
  MaterialAuthoringSignInActions,
  MaterialAuthoringUnauthorizedState,
} from "@/widgets/material-authoring/route-states";
import { withMutationFetch } from "@/storybook/mutation-mock";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { ContentCollectionsPageClient } from "./content-collections-page.client";
import { ContentCollectionsUnavailable } from "./content-collections-unavailable";

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
  ...environment,
  args: { initialCollections: collections, kind: "topic" },
  component: ContentCollectionsPageClient,
  decorators: [
    withMutationFetch(() =>
      Promise.resolve(
        Response.json({ kind: "saved", collection: collections[0] }),
      ),
    ),
    ...environment.decorators,
  ],
  title: "Pages/Authoring/Темы",
} satisfies Meta<typeof ContentCollectionsPageClient>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TopicsDesktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
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

export const TopicsMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
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

/** Сессия не подтверждена: страница маршрута показывает экран входа с возвратом к темам. */
export const SignedOut: Story = {
  render: () => (
    <MaterialAuthoringUnauthorizedState
      action={<MaterialAuthoringSignInActions returnHref="/authoring/topics" />}
      context="editor"
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("heading", {
        name: "Нет доступа к редактору",
      }),
    ).toBeVisible();
  },
};

export const Unavailable: Story = {
  render: () => <ContentCollectionsUnavailable reference="collections-read" />,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Структура временно недоступна" }),
    ).toBeVisible();
    await expect(page.getByText(/Код: collections-read/u)).toBeVisible();
  },
};

export const SavedAfterActivity: Story = {
  render: (args) => (
    <AutosaveActivity>
      <ContentCollectionsPageClient {...args} />
    </AutosaveActivity>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /Product engineering/u }),
    );
    await autosaveWhileHidden(
      canvasElement,
      async () => {
        await userEvent.type(
          canvas.getByRole("textbox", { name: "Название" }),
          " — правка",
        );
      },
      "Сохранено",
      () =>
        Response.json({
          kind: "saved",
          collection: { ...collections[0], version: 4 },
        }),
    );
  },
};
export const FailedAfterActivity: Story = {
  ...SavedAfterActivity,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /Product engineering/u }),
    );
    await autosaveWhileHidden(
      canvasElement,
      async () => {
        await userEvent.type(
          canvas.getByRole("textbox", { name: "Название" }),
          " — правка",
        );
      },
      "Повторить сохранение",
      () => new Response(null, { status: 503 }),
    );
    await expect(canvas.queryByText("Сохранено")).not.toBeInTheDocument();
  },
};
