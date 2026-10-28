import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import type {
  AuthoringMaterialFilterOptions,
  AuthoringMaterialListItem,
  AuthoringMaterialsQuery,
  AuthoringMaterialsState,
} from "@/_pages/authoring-materials/model/authoring-materials-presentation";
import { AuthoringMaterialsLoading } from "@/_pages/authoring-materials/ui/authoring-materials-loading";
import { AuthoringMaterialsPage } from "@/_pages/authoring-materials/ui/authoring-materials-page";
import { AuthoringMaterialsView } from "@/_pages/authoring-materials/ui/authoring-materials-view.client";
import { getQueryClient } from "@/shared/api/query-client";
import { authoringMaterialsRootHref } from "@/shared/routing/authoring";
import {
  captureRouterPush,
  storyRouterPush,
} from "@/shared/ui/admin/admin.fixtures";
import {
  boxOf,
  desktop,
  mobile,
  originOf,
  settleStoryFrame,
  type StoryViewport,
} from "@/storybook/loads-in-place";
import {
  fetchBeforeRender,
  withMutationFetch,
  type MutationFetch,
} from "@/storybook/mutation-mock";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

const topicIds = {
  agents: "96000000-0000-4000-8000-000000000101",
  ai: "96000000-0000-4000-8000-000000000102",
  architecture: "96000000-0000-4000-8000-000000000103",
  testing: "96000000-0000-4000-8000-000000000104",
} as const;

const filterOptions = {
  kind: "ready",
  formats: [
    { label: "Видео", value: "video" },
    { label: "Гайд", value: "guide" },
    { label: "Заметка", value: "note" },
  ],
  topics: [
    { label: "AI Engineering", value: topicIds.ai },
    {
      label: "Архитектура и проектирование систем",
      value: topicIds.architecture,
    },
    { label: "Разработка с агентами", value: topicIds.agents },
    { label: "Тестирование (в архиве)", value: topicIds.testing },
  ],
} satisfies AuthoringMaterialFilterOptions;

const titles = [
  "Как устроен контекст агента и почему он заканчивается раньше, чем кажется",
  "Ревью кода с агентом",
  "Промпт для разбора требований к задаче",
  "Тестирование через поведение: от сценария к проверке",
  "Субагенты",
  "Память проекта: AGENTS.md, CLAUDE.md и правила",
  "Как читать трассировку инструмента",
] as const;
const topics = [
  "AI Engineering",
  "Разработка с агентами",
  "Архитектура и проектирование систем",
] as const;
const formats = ["Гайд", "Видео", "Заметка"] as const;
const states = ["published", "draft", "unpublished"] as const;

function materialId(index: number): string {
  return `96000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

/** Детерминированный список: без случайности и текущих часов. */
function materials(count: number): AuthoringMaterialListItem[] {
  return Array.from({ length: count }, (_, index) => {
    const publicationState = states[index % states.length] ?? "draft";
    return {
      canDelete: publicationState === "draft",
      contentVersion: 2 + (index % 4),
      format: formats[index % formats.length] ?? null,
      materialId: materialId(index),
      publicationState,
      submissionId: `96000000-0000-4000-8000-${String(index + 501).padStart(12, "0")}`,
      title:
        index < titles.length
          ? (titles[index] ?? null)
          : `${titles[index % titles.length] ?? "Материал"} (часть ${String(Math.floor(index / titles.length) + 1)})`,
      topic: topics[index % topics.length] ?? null,
      updatedAt: new Date(
        Date.UTC(2026, 7, 30, 13, 40) - index * 7 * 3_600_000,
      ).toISOString(),
    };
  });
}

const untitledDraft: AuthoringMaterialListItem = {
  canDelete: true,
  contentVersion: 1,
  format: null,
  materialId: materialId(90),
  publicationState: "draft",
  submissionId: materialId(91),
  title: null,
  topic: null,
  updatedAt: "2026-08-29T17:10:00.000Z",
};

function ready(
  items: readonly AuthoringMaterialListItem[],
  totals: { page?: number; totalItems?: number; totalPages?: number } = {},
): Extract<AuthoringMaterialsState, { readonly kind: "ready" }> {
  return {
    kind: "ready",
    items,
    page: totals.page ?? 1,
    pageSize: 20,
    totalItems: totals.totalItems ?? items.length,
    totalPages: totals.totalPages ?? (items.length === 0 ? 0 : 1),
  };
}

const readyState = ready([...materials(3), untitledDraft], {
  totalItems: 35,
  totalPages: 2,
});
const query = { page: 1 } satisfies AuthoringMaterialsQuery;
const filteredQuery = {
  format: "video",
  page: 1,
  publicationState: "draft",
  search: "агент",
  topicId: topicIds.agents,
} satisfies AuthoringMaterialsQuery;
const firstTitle = titles[0];
const firstEditorHref = `/authoring/materials/${materialId(0)}?from=%2Fauthoring%2Fmaterials`;

const publicationSpy = fn(
  (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const publicationState = sentBody(init)?.["publicationState"];
    return Promise.resolve(
      Response.json({
        contentVersion: publicationState === "published" ? 5 : 6,
        kind: "saved",
        nextSubmissionId:
          publicationState === "published"
            ? "96000000-0000-4000-8000-000000000021"
            : "96000000-0000-4000-8000-000000000022",
        publicationState:
          publicationState === "published" ? "published" : "unpublished",
      }),
    );
  },
);

const queryChanged = fn();
const retried = fn();
const environment = authoringPageEnvironment(authoringMaterialsRootHref);

const meta = {
  ...environment,
  args: {
    filterOptions,
    onQueryChange: queryChanged,
    onRetry: retried,
    query,
    state: readyState,
  },
  beforeEach: () => {
    queryChanged.mockClear();
    retried.mockClear();
    const restoreRouter = captureRouterPush();
    const restoreEnvironment = environment.beforeEach();
    return () => {
      restoreRouter();
      restoreEnvironment?.();
    };
  },
  component: AuthoringMaterialsView,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Список материалов админки: таблица по общему образцу списков, фильтры в адресе, редкие действия в «⋯». Страница читает список через browser-owned TanStack Query; Storybook передаёт сериализуемое состояние напрямую.",
      },
    },
  },
  title: "Pages/Authoring/Материалы",
} satisfies Meta<typeof AuthoringMaterialsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  globals: desktop.globals,
  name: "Список · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Материалы", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("35 материалов")).toBeVisible();
    const table = page.getByRole("table", { name: "Материалы" });
    await expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Название", "Состояние", "Изменён", "Действия"]);
    await expect(
      within(table).getByRole("link", { name: firstTitle }),
    ).toHaveAttribute("href", firstEditorHref);
    await expect(
      within(table).getByText("AI Engineering · Гайд"),
    ).toBeVisible();
    await expect(
      within(table).getByText("Без темы · Без формата"),
    ).toBeVisible();
    await expect(
      within(table).getByRole("link", { name: "Черновик без названия" }),
    ).toBeVisible();
    await expect(page.queryByText(/^v\d+$/u)).not.toBeInTheDocument();
    await expect(page.queryByText(materialId(90))).not.toBeInTheDocument();

    // Щелчок по строке вне ссылки открывает тот же редактор с адресом возврата.
    await userEvent.click(within(table).getByText("30 авг. 2026, 16:40"));
    await expect(storyRouterPush).toHaveBeenCalledWith(firstEditorHref);

    const body = within(document.body);
    await userEvent.click(
      page.getByRole("button", { name: `Действия с «${firstTitle}»` }),
    );
    const menu = await body.findByRole("menu");
    await expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Предпросмотр", "Снять с публикации"]);
    await expect(
      within(menu).getByRole("menuitem", { name: "Предпросмотр" }),
    ).toHaveAttribute(
      "href",
      `/authoring/materials/${materialId(0)}/preview?from=%2Fauthoring%2Fmaterials`,
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByRole("menu")).toBeNull());
  },
};

export const DeleteFromMenu: Story = {
  decorators: [withMutationFetch(deletionSpy())],
  globals: desktop.globals,
  name: "Удаление черновика из «⋯»",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const body = within(document.body);
    const draftTitle = titles[1];
    const trigger = page.getByRole("button", {
      name: `Действия с «${draftTitle}»`,
    });
    await userEvent.click(trigger);
    await expect(
      within(await body.findByRole("menu"))
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Предпросмотр", "Опубликовать", "Удалить черновик"]);
    await userEvent.click(
      body.getByRole("menuitem", { name: "Удалить черновик" }),
    );
    const dialog = await body.findByRole("dialog", {
      name: `Удалить «${draftTitle}»?`,
    });
    await expect(dialog).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Оставить черновик" }),
    );
    await waitFor(() => expect(dialog).not.toBeVisible());
    await expect(trigger).toHaveFocus();

    await userEvent.click(trigger);
    await userEvent.click(
      await body.findByRole("menuitem", { name: "Удалить черновик" }),
    );
    await userEvent.click(
      within(
        await body.findByRole("dialog", { name: `Удалить «${draftTitle}»?` }),
      ).getByRole("button", { name: "Удалить безвозвратно" }),
    );
    await expect(
      await page.findByText(`Черновик «${draftTitle}» удалён.`),
    ).toBeInTheDocument();
    await waitFor(() => expect(dialog).not.toBeVisible());
  },
};

export const PublicationFromMenu: Story = {
  args: { state: ready([materials(3)[2] ?? untitledDraft]) },
  decorators: [withMutationFetch(publicationSpy)],
  globals: desktop.globals,
  name: "Публикация из «⋯» · плашка и следующая команда",
  play: async ({ canvasElement }) => {
    publicationSpy.mockClear();
    const page = routeContent(canvasElement);
    const body = within(document.body);
    const title = titles[2];
    const table = page.getByRole("table", { name: "Материалы" });
    await expect(
      within(table).getByText("Снят с публикации", { exact: true }),
    ).toBeVisible();

    await userEvent.click(
      page.getByRole("button", { name: `Действия с «${title}»` }),
    );
    await userEvent.click(
      await body.findByRole("menuitem", { name: "Опубликовать" }),
    );
    await expect(
      await page.findByText(`Материал «${title}» опубликован.`),
    ).toBeInTheDocument();
    await expect(
      within(table).getByText("Опубликован", { exact: true }),
    ).toBeVisible();

    await userEvent.click(
      page.getByRole("button", { name: `Действия с «${title}»` }),
    );
    await userEvent.click(
      await body.findByRole("menuitem", { name: "Снять с публикации" }),
    );
    await expect(
      await page.findByText(`Материал «${title}» снят с публикации.`),
    ).toBeInTheDocument();
    await expect(sentBody(publicationSpy.mock.calls[0]?.[1])).toMatchObject({
      expectedContentVersion: 4,
      publicationState: "published",
    });
    await expect(sentBody(publicationSpy.mock.calls[1]?.[1])).toMatchObject({
      expectedContentVersion: 5,
      publicationState: "unpublished",
      submissionId: "96000000-0000-4000-8000-000000000021",
    });
  },
};

export const PublicationNeedsEditor: Story = {
  args: { state: ready([untitledDraft]) },
  decorators: [
    withMutationFetch(() =>
      Promise.resolve(
        Response.json({
          issues: [{ code: "required", path: "title" }],
          kind: "invalid_input",
        }),
      ),
    ),
  ],
  globals: desktop.globals,
  name: "Публикация · нужно исправить в редакторе",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(
      page.getByRole("button", {
        name: "Действия с «Черновик без названия»",
      }),
    );
    await userEvent.click(
      await within(document.body).findByRole("menuitem", {
        name: "Опубликовать",
      }),
    );
    const alert = await page.findByRole("alert");
    await expect(alert).toHaveTextContent(
      "«Черновик без названия». Материал пока нельзя опубликовать.",
    );
    await expect(
      within(alert).getByRole("link", { name: "Исправить в редакторе" }),
    ).toHaveAttribute(
      "href",
      `/authoring/materials/${materialId(90)}?from=%2Fauthoring%2Fmaterials`,
    );
  },
};

export const Mobile: Story = {
  globals: mobile.globals,
  name: "Список · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.queryByRole("table")).toBeNull();
    const list = page.getByRole("list", { name: "Материалы" });
    const first = within(list).getAllByRole("listitem")[0];
    if (first === undefined) throw new Error("Нет первой строки");
    await expect(
      within(first).getByRole("link", { name: firstTitle }),
    ).toHaveAttribute("href", firstEditorHref);
    await expect(
      within(first).getByText("Изменён 30 авг. 2026, 16:40"),
    ).toBeVisible();
    await expect(within(first).getByText("Опубликован")).toBeVisible();
    await expect(
      within(first).getByRole("button", { name: `Действия с «${firstTitle}»` }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Новый материал" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const SingleMaterial: Story = {
  args: { state: ready(materials(1)) },
  globals: desktop.globals,
  name: "Один материал · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByText("1 материал", { exact: true })).toBeVisible();
    await expect(
      page.queryByRole("navigation", { name: "Страницы материалов" }),
    ).toBeNull();
  },
};

export const SingleMaterialMobile: Story = {
  ...SingleMaterial,
  globals: mobile.globals,
  name: "Один материал · телефон",
  play: async ({ canvasElement }) => {
    await expect(
      within(
        routeContent(canvasElement).getByRole("list", { name: "Материалы" }),
      ).getAllByRole("listitem"),
    ).toHaveLength(1);
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const LongList: Story = {
  args: { state: ready(materials(20), { totalItems: 112, totalPages: 6 }) },
  globals: desktop.globals,
  name: "Длинный список · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const pagination = page.getByRole("navigation", {
      name: "Страницы материалов",
    });
    await expect(within(pagination).getByText("1–20 из 112")).toBeVisible();
    await expect(within(pagination).getByText("Страница 1 из 6")).toBeVisible();
    await userEvent.click(
      within(pagination).getByRole("button", { name: /Следующая/u }),
    );
    await expect(queryChanged).toHaveBeenLastCalledWith({ page: 2 });
  },
};

export const LongListMobile: Story = {
  ...LongList,
  globals: mobile.globals,
  name: "Длинный список · телефон",
  play: async ({ canvasElement }) => {
    await expect(
      within(
        routeContent(canvasElement).getByRole("list", { name: "Материалы" }),
      ).getAllByRole("listitem"),
    ).toHaveLength(20);
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Filtered: Story = {
  args: {
    query: filteredQuery,
    state: ready(materials(2), { totalItems: 2 }),
  },
  globals: desktop.globals,
  name: "Фильтры применены",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("searchbox", {
        name: "Поиск по названию, описанию или адресу",
      }),
    ).toHaveValue("агент");
    await expect(
      page.getByRole("combobox", { name: "Тема" }),
    ).toHaveTextContent("Разработка с агентами");
    await expect(
      page.getByRole("combobox", { name: "Формат" }),
    ).toHaveTextContent("Видео");
    const chips = page.getByRole("list", { name: "Применённые фильтры" });
    await expect(
      within(chips)
        .getAllByRole("listitem")
        .map((chip) => chip.textContent),
    ).toEqual(["Черновики", "Разработка с агентами", "Видео"]);
    await expect(page.getByText("Найдено: 2 материала")).toBeVisible();
    await userEvent.click(
      page.getByRole("button", {
        name: "Убрать фильтр «Разработка с агентами»",
      }),
    );
    await expect(queryChanged).toHaveBeenLastCalledWith({
      format: "video",
      page: 1,
      publicationState: "draft",
      search: "агент",
    });
    await userEvent.click(page.getByRole("button", { name: "Сбросить" }));
    await expect(queryChanged).toHaveBeenLastCalledWith({ page: 1 });
  },
};

export const FilteredMobile: Story = {
  ...Filtered,
  globals: mobile.globals,
  name: "Фильтры применены · телефон",
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("list", {
        name: "Применённые фильтры",
      }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Empty: Story = {
  args: { state: ready([]) },
  globals: desktop.globals,
  name: "Материалов ещё нет",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Материалов пока нет" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Создать материал" }),
    ).toHaveAttribute(
      "href",
      "/authoring/materials/new?from=%2Fauthoring%2Fmaterials",
    );
    await expect(page.queryByRole("searchbox")).toBeNull();
    await expect(page.queryByRole("table")).toBeNull();
  },
};

export const EmptyMobile: Story = {
  ...Empty,
  globals: mobile.globals,
  name: "Материалов ещё нет · телефон",
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("link", {
        name: "Создать материал",
      }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const NoResults: Story = {
  args: { query: filteredQuery, state: ready([]) },
  globals: desktop.globals,
  name: "Ничего не найдено",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Материалы не найдены" }),
    ).toBeVisible();
    await userEvent.click(
      page.getByRole("button", { name: "Сбросить фильтры" }),
    );
    await expect(queryChanged).toHaveBeenLastCalledWith({ page: 1 });
  },
};

export const NoResultsMobile: Story = {
  ...NoResults,
  globals: mobile.globals,
  name: "Ничего не найдено · телефон",
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("button", {
        name: "Сбросить фильтры",
      }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const PagePastEnd: Story = {
  args: {
    query: { page: 4, publicationState: "published" },
    state: ready([], { page: 4, totalItems: 57, totalPages: 3 }),
  },
  globals: desktop.globals,
  name: "Страница за концом списка",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", {
        name: "На этой странице больше нет материалов",
      }),
    ).toBeVisible();
    await userEvent.click(
      page.getByRole("button", { name: "К первой странице" }),
    );
    await expect(queryChanged).toHaveBeenLastCalledWith({
      page: 1,
      publicationState: "published",
    });
  },
};

export const Keyboard: Story = {
  globals: desktop.globals,
  name: "Список · клавиатура",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    // В приложении в содержимое попадают по ссылке «Перейти к содержанию»; отсюда и порядок.
    within(canvasElement).getByRole("main").focus();
    await userEvent.tab();
    await expect(
      page.getByRole("link", { name: "Новый материал" }),
    ).toHaveFocus();
    await userEvent.tab();
    await expect(
      page.getByRole("searchbox", {
        name: "Поиск по названию, описанию или адресу",
      }),
    ).toHaveFocus();
    await userEvent.tab();
    await expect(
      page.getByRole("combobox", { name: "Состояние публикации" }),
    ).toHaveFocus();
  },
};

export const TextZoom: Story = {
  globals: mobile.globals,
  name: "Список · 200% текста",
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const previousFontSize = root.style.fontSize;
    root.style.fontSize = "200%";
    try {
      await expectNoHorizontalOverflow(canvasElement);
      await expect(
        routeContent(canvasElement).getByRole("link", {
          name: "Новый материал",
        }),
      ).toBeVisible();
    } finally {
      root.style.fontSize = previousFontSize;
    }
  },
};

export const Loading: Story = {
  globals: desktop.globals,
  name: "Загрузка",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      within(canvasElement).getByRole("main", {
        name: "Загрузка списка материалов",
      }),
    ).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("status")).toHaveTextContent(
      "Загружаем материалы",
    );
  },
  render: () => <AuthoringMaterialsLoading />,
};

export const LoadingMobile: Story = {
  ...Loading,
  globals: mobile.globals,
  name: "Загрузка · телефон",
};

export const SignedOut: Story = {
  args: { state: { kind: "signed_out" } },
  globals: desktop.globals,
  name: "Нужен вход",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Нужен вход автора" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Войти через Telegram" }),
    ).toBeVisible();
  },
};

export const Forbidden: Story = {
  args: { state: { kind: "forbidden" } },
  globals: desktop.globals,
  name: "Нет доступа",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(page.getByRole("button", { name: "Повторить" }));
    await expect(retried).toHaveBeenCalledTimes(1);
  },
};

export const Unavailable: Story = {
  args: { state: { kind: "unavailable", reference: "dependency-unavailable" } },
  globals: desktop.globals,
  name: "Сервис недоступен",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("alert")).toHaveTextContent(
      "Код обращения: dependency-unavailable",
    );
    await userEvent.click(page.getByRole("button", { name: "Повторить" }));
    await expect(retried).toHaveBeenCalledTimes(1);
  },
};

export const UnavailableMobile: Story = {
  ...Unavailable,
  globals: mobile.globals,
  name: "Сервис недоступен · телефон",
};

export const MalformedResponse: Story = {
  args: { state: { kind: "malformed_response" } },
  globals: desktop.globals,
  name: "Неполный ответ",
};

export const UnexpectedError: Story = {
  args: { state: { kind: "unexpected_error", reference: "request-failed" } },
  globals: desktop.globals,
  name: "Непредвиденная ошибка",
};

/** Ответ списка ждёт, пока проверка не измерит скелет. */
let deliverList: () => void = () => undefined;

function heldListFetch(): MutationFetch {
  const delivered = new Promise<void>((resolve) => {
    deliverList = resolve;
  });
  return async (input) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    );
    if (url.pathname === "/api/authoring/materials/references")
      return Response.json(filterOptions);
    if (url.pathname === "/api/authoring/materials") {
      await delivered;
      return Response.json(readyState);
    }
    return new Response(null, { status: 404 });
  };
}

/** Скелет `loading.tsx` стоит в геометрии списка: ни заголовок, ни начало таблицы не сдвигаются. */
function loadsInPlace({ globals, width }: StoryViewport): Story {
  return {
    beforeEach: () => {
      const restoreEnvironment = environment.beforeEach();
      getQueryClient().removeQueries({ queryKey: ["authoring"] });
      const restoreFetch = fetchBeforeRender(heldListFetch())();
      return () => {
        restoreFetch();
        restoreEnvironment?.();
      };
    },
    globals,
    name: `Загрузка на месте · ${String(width)}`,
    play: async ({ canvasElement }) => {
      await settleStoryFrame(width);
      const page = routeContent(canvasElement);
      await expect(page.getByRole("status")).toHaveTextContent(
        "Загружаем материалы",
      );
      const measure = () => ({
        header: boxOf(canvasElement, "[data-authoring-materials-frame] header"),
        filters: originOf(boxOf(canvasElement, ".admin-filter-bar")),
        table: originOf(
          boxOf(
            canvasElement,
            "[data-authoring-materials-list] .admin-table-root",
          ),
        ),
      });
      const skeleton = measure();

      deliverList();
      // Готовый список приходит в новом `main`: скелет со своим `main` уходит целиком.
      await expect(
        await within(canvasElement).findByText("35 материалов"),
      ).toBeVisible();
      await expect(measure()).toEqual(skeleton);
    },
    render: () => <AuthoringMaterialsPage />,
  };
}

export const LoadsInPlace: Story = loadsInPlace(desktop);
export const LoadsInPlaceMobile: Story = loadsInPlace(mobile);

function deletionSpy(): MutationFetch {
  return (_input, init) => {
    const body = sentBody(init);
    return Promise.resolve(
      Response.json({ kind: "deleted", materialId: body?.["materialId"] }),
    );
  };
}

/** JSON-тело команды жизненного цикла или `undefined`, если тело не JSON-объект. */
function sentBody(
  init: RequestInit | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (typeof init?.body !== "string") return undefined;
  const parsed: unknown = JSON.parse(init.body);
  return typeof parsed === "object" && parsed !== null
    ? Object.fromEntries(Object.entries(parsed))
    : undefined;
}

async function expectNoHorizontalOverflow(canvasElement: HTMLElement) {
  const root = canvasElement.ownerDocument.documentElement;
  await waitFor(() => expect(root.scrollWidth).toBe(root.clientWidth));
}
