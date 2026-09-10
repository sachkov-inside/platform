import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { expect, userEvent, within } from "storybook/test";
import { withMutationFetch } from "@/workshop/mutation-mock";
import { ContentCollectionsPageClient } from "./content-collections-page.client";
import { SeriesEditorPageClient } from "./series-editor-page.client";

const collection = {
  archived: false,
  id: "97000000-0000-4000-8000-000000000003",
  kind: "series",
  materialCount: 4,
  name: "Demo · От проекта до первого релиза",
  slug: "demo-first-release",
  summary:
    "Учебный пример руководства: собираем приложение, готовим окружение и проверяем первый релиз.",
  version: 1,
} as const;
const items = [
  "Подготовка приложения",
  "Сборка контейнера",
  "Настройка окружения",
  "Проверка релиза",
].map((title, index) => ({
  materialId: `97000000-0000-4000-8000-00000000000${String(index + 4)}`,
  title,
  publicationState: index === 3 ? "draft" : "published",
  stepGroup: index < 2 ? "Первый релиз" : null,
}));
function Fixture({
  children,
  empty = false,
}: {
  readonly children: ReactNode;
  readonly empty?: boolean;
}) {
  const [client] = useState(() => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(["series-order", collection.id], {
      kind: "ready",
      order: {
        ...collection,
        seriesId: collection.id,
        orderVersion: "a".repeat(64),
        chapters: [],
        items: empty ? [] : items,
      },
    });
    queryClient.setQueryData(["guide-artifacts", collection.id], {
      artifacts: [],
      kind: "ready",
    });
    queryClient.setQueryData(["guide-artifacts", "reusable"], {
      artifacts: [],
      kind: "ready",
    });
    queryClient.setQueryData(["authoring-home-pin"], {
      kind: "ready",
      pin: { seriesId: collection.id, version: 1 },
    });
    return queryClient;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const meta = {
  component: SeriesEditorPageClient,
  args: { initialCollection: collection },
  decorators: [
    (Story) => (
      <Fixture>
        <Story />
      </Fixture>
    ),
    withMutationFetch(() =>
      Promise.resolve(
        Response.json({ kind: "saved", orderVersion: "b".repeat(64) }),
      ),
    ),
  ],
  parameters: { nextjs: { appDirectory: true } },
  title: "Pages/Authoring/Редактор руководства",
} satisfies Meta<typeof SeriesEditorPageClient>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Desktop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("textbox", { name: "Название руководства" }),
    ).toHaveValue(collection.name);
    await expect(
      canvas.getByRole("list", { name: "Материалы руководства" }),
    ).toBeVisible();
    await expect(canvas.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  },
};
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Empty: Story = {
  decorators: [
    (Story) => (
      <Fixture empty>
        <Story />
      </Fixture>
    ),
  ],
};
export const Archived: Story = {
  args: { initialCollection: { ...collection, archived: true } },
};
export const KeyboardReorder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const handle = canvas.getByRole("button", {
      name: "Переместить «Подготовка приложения»",
    });
    handle.focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(
      canvas.getByRole("list", { name: "Материалы руководства" }).querySelector("li"),
    ).toHaveTextContent("Сборка контейнера");
    await expect(await canvas.findByText("Порядок сохранён.")).toBeVisible();
  },
};
export const List: Story = {
  render: () => (
    <ContentCollectionsPageClient
      kind="series"
      initialCollections={[
        collection,
        {
          ...collection,
          id: "97000000-0000-4000-8000-000000000008",
          name: "Demo · Архитектура приложения",
          materialCount: 8,
        },
        {
          ...collection,
          id: "97000000-0000-4000-8000-000000000009",
          name: "Demo · Работа с базой данных",
          materialCount: 12,
        },
        {
          ...collection,
          id: "97000000-0000-4000-8000-000000000010",
          name: "Demo · Архивное руководство",
          archived: true,
        },
      ]}
    />
  ),
};
export const ListMobile: Story = {
  ...List,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
