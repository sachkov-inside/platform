import {
  AutosaveActivity,
  autosaveWhileHidden,
} from "@/storybook/autosave-activity";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReadonlyURLSearchParams, useSearchParams } from "next/navigation";
import { Suspense, use, useState, type ReactNode } from "react";
import { expect, mocked, userEvent, within } from "storybook/test";
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
import { ProductPageLoading } from "./content-collections-loading.client";
import { ProductEditorPageClient } from "./product-editor-page.client";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

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
  kind: "product",
  materialCount: 4,
  publishedMaterialCount: 2,
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
  {
    id: "97000000-0000-4000-8000-000000000023",
    name: "Эксплуатация",
    summary: "",
  },
];
/** Две главы с материалами, глава без материалов и материал вне глав. */
const chapteredItems = items.map((item, index) => ({
  ...item,
  chapterId: index < 2 ? chapters[0]?.id : index === 2 ? chapters[1]?.id : null,
}));
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
    const selectedItems = empty ? [] : chaptered ? chapteredItems : items;
    queryClient.setQueryData(["product-order", collection.id], {
      kind: "ready",
      order: {
        ...collection,
        productId: collection.id,
        orderVersion: "a".repeat(64),
        chapters: chaptered ? chapters : [],
        items: selectedItems,
        programmePlacements: selectedItems.map((item, index) => ({
          id: `97000000-0000-4000-8000-00000000003${String(index + 1)}`,
          materialId: item.materialId,
          chapterId: "chapterId" in item ? (item.chapterId ?? null) : null,
          stepGroup: item.stepGroup,
        })),
      },
    });
    queryClient.setQueryData(["product-artifacts", collection.id], {
      artifacts: [],
      kind: "ready",
    });
    queryClient.setQueryData(["product-artifacts", "reusable"], {
      artifacts: [],
      kind: "ready",
    });
    queryClient.setQueryData(
      ["authoring", "product-community", collection.id],
      {
        ok: true,
        value: { productId: collection.id, groupRef: "primary" },
      },
    );
    queryClient.setQueryData(["authoring-home-pin"], {
      kind: "ready",
      pin: { productId: collection.id, version: 1 },
    });
    return queryClient;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Адрес редактора, на который ведёт список продуктов: идентификатор совпадает с продуктом. */
const environment = authoringPageEnvironment(
  `/authoring/products/${collection.id}`,
);

const meta = {
  ...environment,
  beforeEach: [
    environment.beforeEach,
    () => () => {
      mocked(useSearchParams).mockReturnValue(new ReadonlyURLSearchParams());
    },
  ],
  component: ProductEditorPageClient,
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
} satisfies Meta<typeof ProductEditorPageClient>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Desktop: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("tab", { name: "Описание и обложка" }),
    );
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("textbox", { name: "Название продукта" }),
    ).toHaveValue(collection.name);
    await userEvent.click(canvas.getByRole("tab", { name: "Программа" }));
    await expect(
      canvas.getByRole("list", { name: "Материалы продукта" }),
    ).toBeVisible();
    await expect(canvas.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  },
};
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

/** Адрес `?tab=description` открывает страницу сразу на описании. */
export const TabFromAddress: Story = {
  globals: desktop.globals,
  beforeEach: () => {
    mocked(useSearchParams).mockReturnValue(
      new ReadonlyURLSearchParams("tab=description"),
    );
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("tab", { name: "Описание и обложка" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("textbox", { name: "Название продукта" }),
    ).toBeVisible();
  },
};

/** Незнакомая вкладка в адресе открывает программу. */
export const UnknownTabFallsBack: Story = {
  globals: mobile.globals,
  beforeEach: () => {
    mocked(useSearchParams).mockReturnValue(
      new ReadonlyURLSearchParams("tab=sales"),
    );
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("tab", { name: "Программа" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByRole("list", { name: "Материалы продукта" }),
    ).toBeVisible();
  },
};

/** Скрытые вкладки остаются смонтированными: несохранённое описание переживает смену вкладки. */
export const DraftSurvivesTabSwitch: Story = {
  globals: mobile.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(
      page.getByRole("tab", { name: "Описание и обложка" }),
    );
    const summary = page.getByRole("textbox", { name: /^Краткое описание/u });
    await userEvent.clear(summary);
    await userEvent.type(summary, "Черновик описания");
    await userEvent.click(page.getByRole("tab", { name: "Настройки" }));
    await expect(summary).not.toBeVisible();
    await userEvent.click(
      page.getByRole("tab", { name: "Описание и обложка" }),
    );
    await expect(summary).toHaveValue("Черновик описания");
  },
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
const importedDecorators = [
  (Story: () => ReactNode) => (
    <Fixture chaptered>
      <Story />
    </Fixture>
  ),
];

/** Продукт, перенесённый из источника, показан для чтения: править и отклонять нечего (#844). */
export const Imported: Story = {
  name: "Продукт из источника",
  args: { initialCollection: importedCollection },
  decorators: importedDecorators,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("tab", { name: "Описание и обложка" }),
    );
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("note")).toHaveTextContent(
      "Продукт перенесён из источника.",
    );
    await expect(
      canvas.getByRole("heading", { name: importedCollection.name, level: 1 }),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("tab", { name: "Программа" }));
    await expect(
      canvas.getByRole("list", { name: "Материалы главы «Сборка»" }),
    ).toHaveTextContent("Подготовка приложения");
    await expect(
      canvas.getByRole("heading", { name: "Глава 3: Эксплуатация" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("list", { name: "Материалы вне глав" }),
    ).toHaveTextContent("Проверка релиза");
    await expect(canvas.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    // Ни одного поля и действия, запись которых backend отклонит.
    await expect(
      canvas.queryByRole("textbox", { name: "Название продукта" }),
    ).toBeNull();
    await expect(canvas.queryByRole("textbox", { name: /глав/u })).toBeNull();
    // «В архив» есть и у артефактов, поэтому архив продукта ищется в его навигации.
    await expect(
      within(
        canvas.getByRole("navigation", { name: "Навигация продукта" }),
      ).queryByRole("button", { name: "В архив" }),
    ).toBeNull();
    // Предпросмотр только читает сохранённое, поэтому он есть и у продукта из источника (#837).
    await expect(
      canvas.getByRole("link", { name: "Предпросмотр главы «Сборка»" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(
        `from=${encodeURIComponent(`/authoring/products/${importedCollection.id}`)}`,
      ),
    );
    await expect(
      canvas.getByRole("link", { name: "Предпросмотр «Проверка релиза»" }),
    ).toBeVisible();
    for (const name of [
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
  decorators: importedDecorators,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const navigation = within(
      canvas.getByRole("navigation", { name: "Навигация продукта" }),
    );
    await expect(navigation.getByText("В архиве")).toBeVisible();
    await expect(
      navigation.queryByRole("button", { name: "Вернуть из архива" }),
    ).toBeNull();
  },
};
/** Источник не дал описаний и материалов: страница не показывает пустых подписей. */
export const ImportedBare: Story = {
  name: "Продукт из источника без описаний и материалов",
  args: {
    initialCollection: {
      ...importedCollection,
      introduction: null,
      materialCount: 0,
      publishedMaterialCount: 0,
      summary: "",
    },
  },
  decorators: [
    (Story) => (
      <Fixture empty>
        <Story />
      </Fixture>
    ),
  ],
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("tab", { name: "Описание и обложка" }),
    );
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("tab", { name: "Программа" }));
    await expect(
      canvas.getByText("В продукте пока нет материалов."),
    ).toBeVisible();
    await expect(canvas.queryByText("Краткое описание")).toBeNull();
    await expect(canvas.queryByText("О продукте для читателя")).toBeNull();
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

export const SavedAfterActivity: Story = {
  render: (args) => (
    <AutosaveActivity>
      <ProductEditorPageClient {...args} />
    </AutosaveActivity>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("tab", { name: "Описание и обложка" }),
    );
    const canvas = within(canvasElement);

    await autosaveWhileHidden(
      canvasElement,
      async () => {
        await userEvent.type(
          canvas.getByRole("textbox", {
            name: "Название продукта",
          }),
          " — правка",
        );
      },
      "Настройки сохранены",
      () =>
        Response.json({
          kind: "saved",
          collection: { ...collection, version: 2 },
        }),
    );
  },
};
export const FailedAfterActivity: Story = {
  ...SavedAfterActivity,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("tab", { name: "Описание и обложка" }),
    );
    const canvas = within(canvasElement);

    await autosaveWhileHidden(
      canvasElement,
      async () => {
        await userEvent.type(
          canvas.getByRole("textbox", {
            name: "Название продукта",
          }),
          " — правка",
        );
      },
      "Повторить сохранение",
      () => new Response(null, { status: 503 }),
    );
    await expect(
      canvas.queryByText("Настройки сохранены"),
    ).not.toBeInTheDocument();
  },
};

function ArrivedProduct({ sequence }: { readonly sequence: StagedLoading }) {
  use(sequence.sharedPart);
  return <ProductEditorPageClient initialCollection={collection} />;
}

function loadsInPlace({ globals, width }: StoryViewport): Story {
  return {
    globals,
    loaders: stagedLoaders,
    render: (_args, { loaded }) => (
      <Suspense fallback={<ProductPageLoading />}>
        <ArrivedProduct sequence={stagedLoadingOf(loaded)} />
      </Suspense>
    ),
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const page = routeContent(canvasElement);
      await expect(page.getByText("Загружаем продукт")).toBeInTheDocument();
      const anchors = () =>
        // Вкладки стоят под названием продукта, высота которого зависит от его длины: скелет
        // держит строку возврата и начало заголовка.
        ["nav[aria-label='Навигация продукта']", ".authoring-page-heading"].map(
          (selector) => originOf(boxOf(canvasElement, selector)),
        );
      const loading = anchors();
      stagedLoadingOf(loaded).deliverSharedPart();
      // Готовая страница приносит свой `main`: прежний ушёл вместе со скелетом.
      await within(canvasElement).findByRole("tablist", {
        name: "Разделы продукта",
      });
      await expect(anchors()).toEqual(loading);
    },
  };
}
export const LoadsInPlace: Story = loadsInPlace(desktop);
export const LoadsInPlaceMobile: Story = loadsInPlace(mobile);
