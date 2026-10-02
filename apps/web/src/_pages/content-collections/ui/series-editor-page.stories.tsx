import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { withMutationFetch } from "@/workshop/mutation-mock";
import { ContentCollectionsPageClient } from "./content-collections-page.client";
import { SeriesEditorPageClient } from "./series-editor-page.client";
import { authoringPageEnvironment } from "@/workshop/story-environment";

const collection = {
  archived: false,
  id: "97000000-0000-4000-8000-000000000003",
  introduction: {
    audience:
      "Разработчики, которые уже написали приложение и хотят впервые выпустить его в тестовое окружение.",
    outcome:
      "Собрать приложение в образ, подготовить окружение и подтвердить первый релиз проверенным сценарием.",
    prerequisites:
      "Базовый Git и умение выполнить команду в терминале. Docker и серверные понятия разбираются по ходу.",
    scope:
      "Один проект и один тестовый сервер. Мониторинг и обслуживание продакшена пока в плане.",
  },
  kind: "series",
  materialCount: 4,
  name: "Demo · От проекта до первого релиза",
  slug: "demo-first-release",
  summary:
    "Учебный пример продукта: собираем приложение, готовим окружение и проверяем первый релиз.",
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
const chapters = [
  {
    id: "97000000-0000-4000-8000-000000000021",
    name: "Сборка",
    summary: "Готовим приложение и собираем образ.",
  },
  { id: "97000000-0000-4000-8000-000000000022", name: "Релиз", summary: "" },
];
function Fixture({
  chaptered = false,
  children,
  empty = false,
}: {
  /** Состав разбит на главы, как у продукта из источника. */
  readonly chaptered?: boolean;
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
        chapters: chaptered ? chapters : [],
        items: empty
          ? []
          : chaptered
            ? items.map((item, index) => ({
                ...item,
                chapterId: chapters[index < 2 ? 0 : 1]?.id ?? null,
              }))
            : items,
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

const environment = authoringPageEnvironment(
  "/authoring/playlists/95000000-0000-4000-8000-000000000010",
);

const meta = {
  ...environment,
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
    ...environment.decorators,
  ],
  title: "Pages/Authoring/Редактор продукта",
} satisfies Meta<typeof SeriesEditorPageClient>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Desktop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("textbox", { name: "Название продукта" }),
    ).toHaveValue(collection.name);
    await expect(
      canvas.getByRole("list", { name: "Материалы продукта" }),
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
const importedCollection = {
  ...collection,
  name: "Demo · Продукт из источника",
  slug: "demo-imported-product",
  sourceId: "inside-content:demo-imported-product",
} as const;
const importedWriteSpy = fn((_input: RequestInfo | URL, _init?: RequestInit) =>
  Promise.resolve(Response.json({ kind: "forbidden" })),
);

/** Продукт, перенесённый из источника, показан для чтения: править и отклонять нечего (#844). */
export const Imported: Story = {
  name: "Продукт из источника",
  args: { initialCollection: importedCollection },
  decorators: [
    (Story) => (
      <Fixture chaptered>
        <Story />
      </Fixture>
    ),
    withMutationFetch(importedWriteSpy),
  ],
  play: async ({ canvasElement }) => {
    importedWriteSpy.mockClear();
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("note")).toHaveTextContent(
      "Продукт перенесён из источника.",
    );
    await expect(canvas.getByText(importedCollection.name)).toBeVisible();
    await expect(
      canvas.getByRole("list", { name: "Материалы главы «Сборка»" }),
    ).toHaveTextContent("Подготовка приложения");
    await expect(
      canvas.getByRole("list", { name: "Материалы главы «Релиз»" }),
    ).toHaveTextContent("Проверка релиза");
    await expect(canvas.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    // Ни одного поля и действия, запись которых backend отклонит.
    await expect(
      canvas.queryByRole("textbox", { name: "Название продукта" }),
    ).toBeNull();
    await expect(canvas.queryByRole("textbox", { name: /глав/u })).toBeNull();
    for (const name of [
      "В архив",
      "Добавить главу",
      "Добавить материал",
      "Убрать «Подготовка приложения»",
      "Переместить «Подготовка приложения»",
      "Повторить сохранение",
    ])
      await expect(canvas.queryByRole("button", { name })).toBeNull();
    await expect(
      canvas.getByRole("button", { name: "Все продукты" }),
    ).toBeEnabled();
    await expect(importedWriteSpy).not.toHaveBeenCalled();
  },
};
export const ImportedMobile: Story = {
  ...Imported,
  name: "Продукт из источника, телефон",
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const ImportedArchived: Story = {
  name: "Продукт из источника в архиве",
  args: { initialCollection: { ...importedCollection, archived: true } },
  decorators: Imported.decorators ?? [],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("В архиве")).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "Вернуть из архива" }),
    ).toBeNull();
  },
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
      canvas
        .getByRole("list", { name: "Материалы продукта" })
        .querySelector("li"),
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
