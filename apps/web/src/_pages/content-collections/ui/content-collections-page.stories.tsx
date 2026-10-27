import {
  AutosaveActivity,
  autosaveWhileHidden,
} from "@/storybook/autosave-activity";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadonlyURLSearchParams, useSearchParams } from "next/navigation";
import { Suspense, use } from "react";
import {
  expect,
  mocked,
  spyOn,
  userEvent,
  waitFor,
  within,
} from "storybook/test";

import {
  MaterialAuthoringSignInActions,
  MaterialAuthoringUnauthorizedState,
} from "@/widgets/material-authoring/route-states";
import { flushPendingEdits } from "@/shared/lib/autosave/use-autosave";
import {
  boxOf,
  desktop,
  mobile,
  originOf,
  settleStoryFrame,
  stagedLoaders,
  stagedLoadingOf,
  type StagedLoading,
  type StoryViewport,
} from "@/storybook/loads-in-place";
import { withMutationFetch } from "@/storybook/mutation-mock";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import type { ContentCollection } from "../model/content-collections";
import { ContentCollectionsLoading } from "./content-collections-loading.client";
import { ContentCollectionsPageClient } from "./content-collections-page.client";
import { ContentCollectionsUnavailable } from "./content-collections-unavailable";

const topic = {
  archived: false,
  id: "97000000-0000-4000-8000-000000000001",
  introduction: null,
  kind: "topic",
  materialCount: 8,
  publishedMaterialCount: 4,
  name: "Product engineering",
  slug: "product-engineering",
  summary: "Продуктовые решения, архитектура и поставка.",
  version: 3,
} as const satisfies ContentCollection;

const collections: readonly ContentCollection[] = [
  {
    ...topic,
    archived: true,
    id: "97000000-0000-4000-8000-000000000002",
    materialCount: 2,
    publishedMaterialCount: 1,
    name: "Legacy topic",
    slug: "legacy-topic",
    summary: "Существующие ссылки сохранены.",
    version: 2,
  },
  topic,
  {
    ...topic,
    id: "97000000-0000-4000-8000-000000000003",
    materialCount: 23,
    publishedMaterialCount: 19,
    name: "Инфраструктура, развёртывание и наблюдаемость сервисов в продакшене",
    slug: "infrastructure-deployment-and-observability",
    version: 1,
  },
];

const environment = authoringPageEnvironment("/authoring/topics");

const meta = {
  ...environment,
  args: { initialCollections: collections, kind: "topic" },
  component: ContentCollectionsPageClient,
  beforeEach: [
    environment.beforeEach,
    () => () => {
      mocked(useSearchParams).mockReturnValue(new ReadonlyURLSearchParams());
    },
  ],
  decorators: [
    withMutationFetch(() =>
      Promise.resolve(Response.json({ kind: "saved", collection: topic })),
    ),
    ...environment.decorators,
  ],
  title: "Pages/Authoring/Темы",
} satisfies Meta<typeof ContentCollectionsPageClient>;

export default meta;
type Story = StoryObj<typeof meta>;

function noHorizontalOverflow(canvasElement: HTMLElement) {
  const root = canvasElement.ownerDocument.documentElement;
  return expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
}

function topicWorkload(size: number): ContentCollection[] {
  return Array.from({ length: size }, (_, index) => ({
    ...topic,
    id: `97000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name: `Тема ${String(index + 1).padStart(4, "0")}`,
    slug: `topic-${String(index + 1)}`,
  }));
}

export const TopicsDesktop: Story = {
  globals: desktop.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Темы" }),
    ).toBeVisible();
    await expect(page.getByText("3 темы")).toBeVisible();
    const table = within(page.getByRole("table", { name: "Все темы" }));
    await expect(
      table.getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual(["Название", "Состояние", "Опубликовано", "Действия"]);
    await expect(table.getByText("В архиве")).toBeVisible();
    await expect(table.getAllByText("Активна")).toHaveLength(2);
    await expect(table.getByText("4 из 8")).toBeVisible();
    await expect(table.getByText("/product-engineering")).toBeVisible();
    await expect(
      table.getByRole("link", { name: "Product engineering" }),
    ).toHaveAttribute("href", `/authoring/topics?topic=${topic.id}`);
    await expect(
      page.queryByRole("textbox", { name: "Название" }),
    ).not.toBeInTheDocument();
    await noHorizontalOverflow(canvasElement);
  },
};

export const TopicsMobile: Story = {
  globals: mobile.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const list = page.getByRole("list", { name: "Все темы" });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    await expect(within(list).getByText("Опубликовано: 4 из 8")).toBeVisible();
    await noHorizontalOverflow(canvasElement);
  },
};

/** Строка открывает тему на этой же странице, «Все темы» возвращает фокус на её строку. */
export const OpensTopicEditor: Story = {
  globals: desktop.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(page.getByText("4 из 8"));
    const heading = page.getByRole("heading", {
      level: 1,
      name: "Product engineering",
    });
    await expect(heading).toHaveFocus();
    await expect(page.getByRole("textbox", { name: "Название" })).toHaveValue(
      "Product engineering",
    );
    await expect(page.queryByRole("table")).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Все темы" }));
    const link = page.getByRole("link", { name: "Product engineering" });
    await waitFor(() => expect(link).toHaveFocus());
    await expect(page.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  },
};

export const OpensTopicEditorMobile: Story = {
  globals: mobile.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(
      within(page.getByRole("list", { name: "Все темы" })).getByRole("link", {
        name: "Инфраструктура, развёртывание и наблюдаемость сервисов в продакшене",
      }),
    );
    await expect(page.getByRole("textbox", { name: "Название" })).toHaveValue(
      "Инфраструктура, развёртывание и наблюдаемость сервисов в продакшене",
    );
    await expect(page.getByText("Опубликовано 19 из 23")).toBeVisible();
    await noHorizontalOverflow(canvasElement);
  },
};

/** Адрес `?topic=` открывает тему сразу; поиск в адресе ждёт возврата к списку. */
export const TopicFromAddress: Story = {
  globals: desktop.globals,
  beforeEach: () => {
    mocked(useSearchParams).mockReturnValue(
      new ReadonlyURLSearchParams(`search=Legacy&topic=${topic.id}`),
    );
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Product engineering" }),
    ).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Все темы" }));
    await expect(
      page.getByRole("searchbox", { name: "Поиск по темам" }),
    ).toHaveValue("Legacy");
    await expect(
      within(page.getByRole("table", { name: "Все темы" })).getAllByRole("row"),
    ).toHaveLength(2);
  },
};

export const UnknownTopic: Story = {
  globals: mobile.globals,
  beforeEach: () => {
    mocked(useSearchParams).mockReturnValue(
      new ReadonlyURLSearchParams("topic=97000000-0000-4000-8000-000000000999"),
    );
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Тема не найдена" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Все темы" })).toHaveAttribute(
      "href",
      "/authoring/topics",
    );
  },
};

/** «⋯» убирает тему в архив без открытия; плашка и фильтр архива видят новое состояние. */
export const ArchiveFromRowMenu: Story = {
  globals: desktop.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const originalFetch = window.fetch;
    const write = spyOn(window, "fetch").mockImplementation((input, init) => {
      if (init?.method !== "PUT") return originalFetch(input, init);
      return Promise.resolve(
        Response.json({
          kind: "saved",
          collection: { ...topic, archived: true, version: 4 },
        }),
      );
    });
    try {
      await userEvent.click(
        page.getByRole("button", { name: "Действия с «Product engineering»" }),
      );
      await userEvent.click(
        within(canvasElement.ownerDocument.body).getByRole("menuitem", {
          name: "В архив",
        }),
      );
      await expect(await page.findByText("Изменения сохранены.")).toBeVisible();
      await expect(write).toHaveBeenCalledOnce();
      await expect(
        within(page.getByRole("table", { name: "Все темы" })).getAllByText(
          "В архиве",
        ),
      ).toHaveLength(2);
    } finally {
      write.mockRestore();
    }
  },
};

export const NoResults: Story = {
  globals: mobile.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.type(
      page.getByRole("searchbox", { name: "Поиск по темам" }),
      "Нет такой темы",
    );
    await expect(
      page.getByRole("heading", { name: "Ничего не найдено" }),
    ).toBeVisible();
    await userEvent.click(
      page.getByRole("button", { name: "Сбросить фильтры" }),
    );
    await expect(
      within(page.getByRole("list", { name: "Все темы" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(3);
  },
};

export const EmptyMobile: Story = {
  args: { initialCollections: [] },
  globals: mobile.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Тем пока нет" }),
    ).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Создать тему" }));
    await expect(page.getByRole("textbox", { name: /^Адрес/u })).toBeVisible();
    await noHorizontalOverflow(canvasElement);
  },
};

export const EmptyDesktop: Story = {
  args: { initialCollections: [] },
  globals: desktop.globals,
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
  globals: mobile.globals,
  render: () => (
    <ContentCollectionsUnavailable kind="topic" reference="collections-read" />
  ),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Список временно недоступен" }),
    ).toBeVisible();
    await expect(
      page.getByText("Код обращения: collections-read"),
    ).toBeVisible();
  },
};

async function openFirstTopic(canvasElement: HTMLElement, name: string) {
  const page = routeContent(canvasElement);
  await userEvent.click(page.getByRole("link", { name }));
  return page;
}

export const SavedAfterActivity: Story = {
  render: (args) => (
    <AutosaveActivity>
      <ContentCollectionsPageClient {...args} />
    </AutosaveActivity>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openFirstTopic(canvasElement, "Product engineering");
    await autosaveWhileHidden(
      canvasElement,
      async () => {
        await userEvent.type(
          canvas.getByRole("textbox", { name: "Название" }),
          " · правка",
        );
      },
      "Сохранено",
      () =>
        Response.json({
          kind: "saved",
          collection: { ...topic, version: 4 },
        }),
    );
  },
};
export const FailedAfterActivity: Story = {
  ...SavedAfterActivity,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openFirstTopic(canvasElement, "Product engineering");
    await autosaveWhileHidden(
      canvasElement,
      async () => {
        await userEvent.type(
          canvas.getByRole("textbox", { name: "Название" }),
          " · правка",
        );
      },
      "Повторить сохранение",
      () => new Response(null, { status: 503 }),
    );
    await expect(canvas.queryByText("Сохранено")).not.toBeInTheDocument();
  },
};

function topicCollectionWorkload(size: number): Story {
  return {
    args: { initialCollections: topicWorkload(size) },
    play: async ({ canvasElement }) => {
      const page = routeContent(canvasElement);
      await expect(
        page.getAllByRole("link", { name: /^Тема \d+$/u }),
      ).toHaveLength(Math.min(size, 50));
      const last = `Тема ${String(size).padStart(4, "0")}`;
      await userEvent.type(
        page.getByRole("searchbox", { name: "Поиск по темам" }),
        last,
      );
      await userEvent.click(page.getByRole("link", { name: last }));
      await expect(page.getByRole("textbox", { name: "Название" })).toHaveValue(
        last,
      );
    },
  };
}
export const CollectionWorkloadOne: Story = topicCollectionWorkload(1);
export const CollectionWorkloadHundred: Story = topicCollectionWorkload(100);
export const CollectionWorkloadThousand: Story = topicCollectionWorkload(1000);

/**
 * Правки темы сохраняются перед возвратом к списку и переживают поиск, открытие другой темы и
 * пересортировку по сохранённому названию. Тему без названия сохранить нельзя: автор остаётся в
 * ней, черновик не теряется.
 */
export const DraftAcrossSearchAndResort: Story = {
  args: { initialCollections: topicWorkload(40) },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const originalFetch = window.fetch;
    const lastId = "97000000-0000-4000-8000-000000000040";
    const write = spyOn(window, "fetch").mockImplementation((input, init) => {
      const raw = init?.body;
      const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : null;
      const body: Record<string, unknown> =
        typeof parsed === "object" && parsed !== null
          ? Object.fromEntries(Object.entries(parsed))
          : {};
      const name = body["name"];
      const id = body["collectionId"];
      if (typeof name !== "string" || typeof id !== "string")
        return originalFetch(input, init);
      return Promise.resolve(
        Response.json({
          kind: "saved",
          collection: {
            ...topic,
            id,
            name,
            slug: `topic-${String(Number(id.slice(-12)))}`,
            version: 4,
          },
        }),
      );
    });
    try {
      await userEvent.click(page.getByRole("link", { name: "Тема 0001" }));
      await userEvent.type(
        page.getByRole("textbox", { name: "Название" }),
        " · черновик",
      );
      await userEvent.click(page.getByRole("button", { name: "Все темы" }));
      const search = page.getByRole("searchbox", { name: "Поиск по темам" });
      await userEvent.type(search, "Тема 0040");
      await userEvent.click(page.getByRole("link", { name: "Тема 0040" }));
      const lastName = page.getByRole("textbox", { name: "Название" });
      await userEvent.clear(lastName);
      await userEvent.type(lastName, "ААА новая первая тема");
      await userEvent.click(page.getByRole("button", { name: "Все темы" }));
      await expect(
        write.mock.calls.some(
          ([, init]) =>
            typeof init?.body === "string" && init.body.includes(lastId),
        ),
      ).toBe(true);
      await userEvent.clear(search);
      const table = within(page.getByRole("table", { name: "Все темы" }));
      await expect(table.getAllByRole("link")[0]).toHaveTextContent(
        "ААА новая первая тема",
      );
      await userEvent.click(
        table.getByRole("link", { name: "Тема 0001 · черновик" }),
      );
      const firstName = page.getByRole("textbox", { name: "Название" });
      await expect(firstName).toHaveValue("Тема 0001 · черновик");
      await userEvent.clear(firstName);
      await userEvent.click(page.getByRole("button", { name: "Все темы" }));
      await expect(firstName).toBeVisible();
      await expect(firstName).toHaveValue("");
      await expect(page.getByText("Не сохранено")).toBeVisible();
    } finally {
      await flushPendingEdits();
      write.mockRestore();
    }
  },
};

function ArrivedTopics({ sequence }: { readonly sequence: StagedLoading }) {
  use(sequence.sharedPart);
  return (
    <ContentCollectionsPageClient
      initialCollections={collections}
      kind="topic"
    />
  );
}

function loadsInPlace({ globals, width }: StoryViewport): Story {
  return {
    globals,
    loaders: stagedLoaders,
    render: (_args, { loaded }) => (
      <Suspense fallback={<ContentCollectionsLoading kind="topic" />}>
        <ArrivedTopics sequence={stagedLoadingOf(loaded)} />
      </Suspense>
    ),
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const page = routeContent(canvasElement);
      await expect(
        page.getByText("Загружаем темы", { selector: "span" }),
      ).toBeInTheDocument();
      const anchors = () =>
        [".admin-list-header h1", ".admin-filter-bar", ".admin-table-root"].map(
          (selector) => originOf(boxOf(canvasElement, selector)),
        );
      const loading = anchors();
      stagedLoadingOf(loaded).deliverSharedPart();
      // Готовая страница приносит свой `main`: прежний ушёл вместе со скелетом.
      await within(canvasElement).findByRole(width < 768 ? "list" : "table", {
        name: "Все темы",
      });
      await expect(anchors()).toEqual(loading);
    },
  };
}
export const LoadsInPlace: Story = loadsInPlace(desktop);
export const LoadsInPlaceMobile: Story = loadsInPlace(mobile);
