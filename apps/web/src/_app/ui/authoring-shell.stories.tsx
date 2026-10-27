import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import type {
  AuthoringMaterialListItem,
  AuthoringMaterialsState,
} from "@/_pages/authoring-materials/model/authoring-materials-presentation";
import { AuthoringMaterialsView } from "@/_pages/authoring-materials/ui/authoring-materials-view.client";
import { getQueryClient } from "@/shared/api/query-client";
import {
  captureRouterPush,
  storyRouterPush,
  touchTarget,
} from "@/shared/ui/admin/admin.fixtures";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { authoringPageEnvironment } from "@/storybook/story-environment";

/**
 * Каркас админки (#1717, решения 2, 8 и 13) вокруг настоящей страницы «Материалы»: боковая
 * панель с группами и счётчиком «Сдач», общий поиск `⌘K`/`Ctrl+K`, на телефоне верхняя строка,
 * вкладки подразделов, нижняя панель и лист «Ещё».
 */
const desktop = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
} as const;
const mobile = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
} as const;

const items: readonly AuthoringMaterialListItem[] = [
  {
    canDelete: false,
    contentVersion: 4,
    format: "Гайд",
    materialId: "96000000-0000-4000-8000-000000000001",
    publicationState: "published",
    submissionId: "96000000-0000-4000-8000-000000000501",
    title:
      "Как устроен контекст агента и почему он заканчивается раньше, чем кажется",
    topic: "Разработка с агентами",
    updatedAt: "2026-10-24T11:05:00.000Z",
  },
  {
    canDelete: true,
    contentVersion: 2,
    format: "Видео",
    materialId: "96000000-0000-4000-8000-000000000002",
    publicationState: "draft",
    submissionId: "96000000-0000-4000-8000-000000000502",
    title: "Ревью кода с агентом",
    topic: "AI Engineering",
    updatedAt: "2026-10-23T08:40:00.000Z",
  },
];
const state = {
  kind: "ready",
  items,
  page: 1,
  pageSize: 20,
  totalItems: items.length,
  totalPages: 1,
} satisfies AuthoringMaterialsState;

const productId = "96000000-0000-4000-8000-000000000210";
const searchRequests = fn();

/** Ответ BFF общего поиска; `kind` выбирает состояние, которое показывает окно. */
function searchResponse(kind: "ready" | "forbidden" | "partly_unavailable") {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    );
    if (url.pathname !== "/api/authoring/search")
      return Promise.resolve(new Response(null, { status: 404 }));
    searchRequests(url.searchParams.get("query"));
    if (kind === "forbidden")
      return Promise.resolve(
        Response.json({ kind: "forbidden" }, { status: 403 }),
      );
    return Promise.resolve(
      Response.json({
        kind: "ready",
        groups: [
          {
            kind: "products",
            state: "ready",
            items: [
              {
                archived: false,
                id: productId,
                name: "AI Engineering: агенты в работе",
              },
              {
                archived: true,
                id: "96000000-0000-4000-8000-000000000211",
                name: "Агенты для команды (поток 2025)",
              },
            ],
          },
          kind === "partly_unavailable"
            ? { kind: "materials", state: "unavailable" }
            : {
                kind: "materials",
                state: "ready",
                items: [
                  {
                    id: "96000000-0000-4000-8000-000000000001",
                    publicationState: "published",
                    title:
                      "Как устроен контекст агента и почему он заканчивается раньше, чем кажется",
                    topic: "Разработка с агентами",
                  },
                  {
                    id: "96000000-0000-4000-8000-000000000003",
                    publicationState: "draft",
                    title: null,
                    topic: null,
                  },
                ],
              },
        ],
      }),
    );
  };
}

function shellEnvironment({
  awaitingFeedbackCount = 4,
  search,
}: {
  readonly awaitingFeedbackCount?: number | null;
  readonly search?: "ready" | "forbidden" | "partly_unavailable";
} = {}): Pick<Story, "beforeEach" | "decorators" | "parameters"> {
  const environment = authoringPageEnvironment("/authoring/materials", {
    awaitingFeedbackCount,
  });
  return {
    ...environment,
    beforeEach: () => {
      getQueryClient().clear();
      searchRequests.mockClear();
      const restoreRouter = captureRouterPush();
      const restoreEnvironment = environment.beforeEach();
      const restoreFetch =
        search === undefined
          ? undefined
          : fetchBeforeRender(searchResponse(search))();
      return () => {
        restoreFetch?.();
        restoreRouter();
        restoreEnvironment?.();
      };
    },
  };
}

const meta = {
  args: {
    filterOptions: { kind: "ready", formats: [], topics: [] },
    onQueryChange: fn(),
    onRetry: fn(),
    query: { page: 1 },
    state,
  },
  component: AuthoringMaterialsView,
  parameters: {
    docs: {
      description: {
        component:
          "Каркас админки в том составе, который надевает `app/authoring/layout.tsx`. Меню задаёт `widgets/authoring-shell/model/navigation.ts`; пункты будущих задач ведут на нынешние страницы. Счётчик «Сдач» на маршруте приносит чтение браузера, здесь его задаёт окружение.",
      },
    },
  },
  title: "Patterns/Каркас админки",
} satisfies Meta<typeof AuthoringMaterialsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  ...desktop,
  ...shellEnvironment(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const sidebar = canvas.getByRole("complementary", { name: "Админка" });
    const navigation = within(sidebar).getByRole("navigation", {
      name: "Разделы админки",
    });
    for (const group of ["Контент", "Ученики", "Продажи"])
      await expect(within(navigation).getByText(group)).toBeVisible();
    await expect(
      within(navigation).getByRole("link", { name: "Материалы" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      within(navigation).getByRole("link", {
        name: "Сдачи, без комментария: 4",
      }),
    ).toHaveAttribute("href", "/authoring/submissions");
    // Иконка у каждого пункта меню.
    for (const link of within(navigation).getAllByRole("link"))
      await expect(link.querySelector("svg")).not.toBeNull();
    await expect(
      within(sidebar).getByRole("link", { name: "На публичный сайт" }),
    ).toHaveAttribute("href", "/");
    await expect(
      within(sidebar).getByRole("link", { name: "Библиотека материалов" }),
    ).toHaveAttribute("href", "/");
    await expect(
      canvas.getByRole("button", { name: "Поиск по админке" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("navigation", { name: "Основные разделы" }),
    ).toBeNull();
    const main = canvas.getByRole("main");
    await expect(main.getBoundingClientRect().left).toBe(
      sidebar.getBoundingClientRect().width,
    );
  },
};

/** Без права на сдачи или при сбое чтения у «Сдач» нет числа, а не ноль. */
export const DesktopWithoutCounter: Story = {
  ...desktop,
  ...shellEnvironment({ awaitingFeedbackCount: null }),
  play: async ({ canvasElement }) => {
    const navigation = within(canvasElement).getByRole("navigation", {
      name: "Разделы админки",
    });
    await expect(
      within(navigation).getByRole("link", { name: "Сдачи" }),
    ).toBeVisible();
    await expect(canvasElement.querySelector("[data-nav-counter]")).toBeNull();
  },
};

export const Mobile: Story = {
  ...mobile,
  ...shellEnvironment(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("complementary", { name: "Админка" }),
    ).toBeNull();
    const tabs = canvas.getByRole("navigation", {
      name: "Подразделы: Контент",
    });
    await expect(
      within(tabs)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Продукты", "Материалы", "Темы"]);
    await expect(
      within(tabs).getByRole("link", { name: "Материалы" }),
    ).toHaveAttribute("aria-current", "page");
    const dock = canvas.getByRole("navigation", { name: "Основные разделы" });
    const targets = [
      ...within(dock).getAllByRole("link"),
      within(dock).getByRole("button", { name: "Ещё" }),
    ];
    await expect(targets.map((target) => target.textContent)).toEqual([
      "Обзор",
      "Люди",
      "Продажи",
      "Сдачи4",
      "Ещё",
    ]);
    for (const target of targets) {
      const size = touchTarget(target);
      await expect(size.height).toBeGreaterThanOrEqual(44);
      await expect(size.width).toBeGreaterThanOrEqual(44);
    }
    await expect(
      within(dock).getByRole("link", { name: "Сдачи, без комментария: 4" }),
    ).toBeVisible();
    const document = canvasElement.ownerDocument.documentElement;
    await expect(document.scrollWidth).toBe(document.clientWidth);
  },
};

/** «Ещё»: лист с остальными разделами и ссылками на сайт; Escape возвращает фокус на «Ещё». */
export const MobileMoreSheet: Story = {
  ...mobile,
  ...shellEnvironment(),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const more = canvas.getByRole("button", { name: "Ещё" });
    await userEvent.click(more);
    await expect(more).toHaveAttribute("aria-expanded", "true");
    const sheet = await canvas.findByRole("dialog", { name: "Ещё" });
    const sections = within(sheet).getByRole("navigation", {
      name: "Другие разделы",
    });
    await expect(
      within(sections)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Продукты",
      "Материалы",
      "Темы",
      "Ссылки на оплату",
      "Скидки",
      "Воронка продаж",
    ]);
    await expect(
      within(sections).getByRole("link", { name: "Материалы" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      within(sheet).getByRole("link", { name: "На публичный сайт" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(more).toHaveAttribute("aria-expanded", "false"));
    await expect(canvas.queryByRole("dialog", { name: "Ещё" })).toBeNull();
    await waitFor(() => expect(more).toHaveFocus());
  },
};

/** `Ctrl+K` открывает поиск; стрелки выбирают результат, Enter открывает его. */
export const SearchDesktop: Story = {
  ...desktop,
  ...shellEnvironment({ search: "ready" }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.keyboard("{Control>}k{/Control}");
    const dialog = await canvas.findByRole("dialog", {
      name: "Поиск по админке",
    });
    const input = within(dialog).getByRole("combobox", { name: "Что найти" });
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.type(input, "агент");
    const products = await within(dialog).findByRole("group", {
      name: "Продукты",
    });
    await expect(searchRequests).toHaveBeenLastCalledWith("агент");
    await expect(
      within(products)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "AI Engineering: агенты в работе",
      "Агенты для команды (поток 2025)Архив",
    ]);
    const materials = within(dialog).getByRole("group", { name: "Материалы" });
    await expect(
      within(materials).getByRole("option", {
        name: /^Черновик без названия/u,
      }),
    ).toBeVisible();
    await expect(within(products).getAllByRole("option")[0]).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.keyboard("{ArrowDown}");
    await expect(within(products).getAllByRole("option")[1]).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.keyboard("{ArrowUp}{Enter}");
    await expect(storyRouterPush).toHaveBeenCalledWith(
      `/authoring/products/${productId}`,
    );
    await waitFor(() =>
      expect(
        canvas.queryByRole("dialog", { name: "Поиск по админке" }),
      ).toBeNull(),
    );
  },
};

/** Одна группа не ответила: она названа, остальные результаты остаются. */
export const SearchPartlyUnavailable: Story = {
  ...desktop,
  ...shellEnvironment({ search: "partly_unavailable" }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Поиск по админке" }),
    );
    const dialog = await canvas.findByRole("dialog", {
      name: "Поиск по админке",
    });
    await userEvent.type(
      within(dialog).getByRole("combobox", { name: "Что найти" }),
      "агент",
    );
    await expect(
      await within(dialog).findByText("Материалы: поиск временно недоступен."),
    ).toBeVisible();
    await expect(
      within(dialog).getByRole("group", { name: "Продукты" }),
    ).toBeVisible();
  },
};

/** Телефон: кнопка поиска в верхней строке; аккаунт без права получает отказ, а не пустой ответ. */
export const SearchForbiddenMobile: Story = {
  ...mobile,
  ...shellEnvironment({ search: "forbidden" }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Поиск по админке" });
    await expect(touchTarget(trigger).height).toBeGreaterThanOrEqual(44);
    await userEvent.click(trigger);
    const dialog = await canvas.findByRole("dialog", {
      name: "Поиск по админке",
    });
    await userEvent.type(
      within(dialog).getByRole("combobox", { name: "Что найти" }),
      "агент",
    );
    await expect(
      await within(dialog).findByText(
        "Поиск открыт аккаунту с правом управлять материалами.",
      ),
    ).toBeVisible();
    await expect(within(dialog).queryAllByRole("option")).toHaveLength(0);
    const document = canvasElement.ownerDocument.documentElement;
    await expect(document.scrollWidth).toBe(document.clientWidth);
  },
};
