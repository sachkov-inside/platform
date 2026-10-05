import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

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

const product = {
  archived: false,
  id: "97000000-0000-4000-8000-000000000003",
  introduction: null,
  kind: "series",
  materialCount: 4,
  name: "Demo · От проекта до первого релиза",
  slug: "demo-first-release",
  summary:
    "Учебный пример продукта: собираем приложение, готовим окружение и проверяем первый релиз.",
  version: 1,
} as const;

const products = [
  product,
  {
    ...product,
    id: "97000000-0000-4000-8000-000000000008",
    name: "Demo · Архитектура приложения",
    slug: "demo-architecture",
    materialCount: 8,
  },
  {
    ...product,
    id: "97000000-0000-4000-8000-000000000009",
    name: "Demo · Работа с базой данных",
    slug: "demo-database",
    materialCount: 12,
  },
  {
    ...product,
    id: "97000000-0000-4000-8000-000000000010",
    name: "Demo · Архивное руководство",
    slug: "demo-archived",
    archived: true,
  },
] as const;

/** Раздел «Продукты»: навигация ведёт на `/authoring/guides`, маршрут рендерит список продуктов. */
const environment = authoringPageEnvironment("/authoring/guides");

const meta = {
  ...environment,
  args: { initialCollections: products, kind: "series" },
  component: ContentCollectionsPageClient,
  decorators: [
    withMutationFetch(() =>
      Promise.resolve(Response.json({ kind: "saved", collection: product })),
    ),
    ...environment.decorators,
  ],
  title: "Pages/Authoring/Продукты",
} satisfies Meta<typeof ContentCollectionsPageClient>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GuidesDesktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: /Продукты/u }),
    ).toBeVisible();
    await expect(
      within(canvasElement)
        .getAllByRole("link", { name: "Продукты" })
        .some((link) => link.getAttribute("aria-current") === "page"),
    ).toBe(true);
  },
};

export const GuidesMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", {
      name: "Создать продукт",
    });
    await expect(button).toBeVisible();
    const bounds = button.getBoundingClientRect();
    await expect(bounds.left).toBeGreaterThanOrEqual(0);
    await expect(bounds.right).toBeLessThanOrEqual(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};

export const Empty: Story = {
  args: { initialCollections: [] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Пока ничего нет"),
    ).toBeVisible();
  },
};

/** Сессия не подтверждена: страница маршрута показывает экран входа с возвратом к продуктам. */
export const SignedOut: Story = {
  render: () => (
    <MaterialAuthoringUnauthorizedState
      action={<MaterialAuthoringSignInActions returnHref="/authoring/guides" />}
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
};
