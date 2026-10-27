import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import type { PeopleListQuery } from "@/_pages/authoring-people/model/people-list";
import { AuthoringPeopleLoading } from "@/_pages/authoring-people/ui/authoring-people-loading";
import { AuthoringPeoplePage } from "@/_pages/authoring-people/ui/authoring-people-page";
import { AuthoringPeopleView } from "@/_pages/authoring-people/ui/authoring-people-view.client";
import { getQueryClient } from "@/shared/api/query-client";
import {
  authoringPeopleHref,
  authoringPersonHref,
} from "@/shared/routing/authoring";
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
  type MutationFetch,
} from "@/storybook/mutation-mock";
import {
  annaRow,
  noTelegramRow,
  peopleState,
  storyAnnaId,
  storyPeopleRows,
  storyProducts,
  unknownContactsRow,
} from "@/storybook/people.fixtures";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

const catalog = { kind: "ready", products: storyProducts } as const;
const readyState = peopleState(
  [annaRow, noTelegramRow, unknownContactsRow, ...storyPeopleRows(5)],
  { total: 134, nextCursor: "o:25" },
);
const filteredQuery = {
  origin: "manual",
  productId: storyProducts[1].productId,
  search: "петрова",
  state: "revoked",
} satisfies PeopleListQuery;

const queryChanged = fn();
const retried = fn();
const environment = authoringPageEnvironment(authoringPeopleHref);

const meta = {
  ...environment,
  args: {
    catalog,
    onQueryChange: queryChanged,
    onRetry: retried,
    query: {},
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
  component: AuthoringPeopleView,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Список людей админки (#1721) по общему образцу: человек по решению 5 (имя Telegram, @username, email), продукты с состоянием доступа, регистрация и последняя активность. Фильтры и курсор живут в адресе; страница читает список через browser-owned TanStack Query, Storybook передаёт состояние напрямую.",
      },
    },
  },
  title: "Pages/Authoring/Люди",
} satisfies Meta<typeof AuthoringPeopleView>;

export default meta;
type Story = StoryObj<typeof meta>;

async function expectNoHorizontalOverflow(canvasElement: HTMLElement) {
  const root = canvasElement.ownerDocument.documentElement;
  await waitFor(() => expect(root.scrollWidth).toBe(root.clientWidth));
}

export const Populated: Story = {
  globals: desktop.globals,
  name: "Список · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Люди" }),
    ).toBeVisible();
    await expect(page.getByText("134 человека")).toBeVisible();
    const table = page.getByRole("table", { name: "Люди, новые сверху" });
    await expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "Человек",
      "Продукты",
      "Регистрация",
      "Последняя активность",
      "Действия",
    ]);
    await expect(
      within(table).getByRole("link", { name: "Анна Петрова" }),
    ).toHaveAttribute("href", authoringPersonHref(storyAnnaId));
    await expect(
      within(table).getByText("@anna_petrova · anna.petrova@example.test"),
    ).toBeVisible();
    // Без Telegram и без имени: заголовок email, подстрока называет отсутствие связи.
    await expect(within(table).getByText("Telegram не связан")).toBeVisible();
    await expect(
      within(table).getByRole("link", {
        name: "Контакты временно недоступны",
      }),
    ).toBeVisible();
    await expect(page.queryByText(storyAnnaId)).not.toBeInTheDocument();

    await userEvent.click(within(table).getByText("2 сент. 2026"));
    await expect(storyRouterPush).toHaveBeenCalledWith(
      authoringPersonHref(storyAnnaId),
    );
    await userEvent.click(
      page.getByRole("button", { name: "Действия с «Анна Петрова»" }),
    );
    const menu = await within(document.body).findByRole("menu");
    await expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Открыть карточку", "Скопировать ID"]);
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(within(document.body).queryByRole("menu")).toBeNull(),
    );
  },
};

export const Mobile: Story = {
  globals: mobile.globals,
  name: "Список · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.queryByRole("table")).toBeNull();
    const list = page.getByRole("list", { name: "Люди, новые сверху" });
    const first = within(list).getAllByRole("listitem")[0];
    if (first === undefined) throw new Error("Нет первой строки");
    await expect(
      within(first).getByRole("link", { name: "Анна Петрова" }),
    ).toBeVisible();
    await expect(
      within(first).getByText(
        `${storyProducts[0].name}, ${storyProducts[1].name} (отозван)`,
      ),
    ).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const SinglePerson: Story = {
  args: { state: peopleState([annaRow]) },
  globals: desktop.globals,
  name: "Один человек",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByText("1 человек", { exact: true })).toBeVisible();
    await expect(
      page.queryByRole("navigation", { name: "Страницы списка людей" }),
    ).toBeNull();
  },
};

export const SinglePersonMobile: Story = {
  ...SinglePerson,
  globals: mobile.globals,
  name: "Один человек · телефон",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const LongList: Story = {
  args: {
    query: { cursor: "o:25" },
    state: peopleState(storyPeopleRows(25), { total: 134, nextCursor: "o:50" }),
  },
  globals: desktop.globals,
  name: "Длинный список и длинные имена",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const pagination = page.getByRole("navigation", {
      name: "Страницы списка людей",
    });
    await expect(
      within(pagination).getByRole("link", { name: "Дальше" }),
    ).toHaveAttribute("href", `${authoringPeopleHref}?cursor=o%3A50`);
    await expect(
      within(pagination).getByRole("link", { name: "К началу списка" }),
    ).toHaveAttribute("href", authoringPeopleHref);
    await expect(
      page.getAllByText("Константин Константинопольский-Задунайский").length,
    ).toBeGreaterThan(0);
    await expect(page.getAllByText(/^и ещё 1$/u).length).toBeGreaterThan(0);
  },
};

export const LongListMobile: Story = {
  ...LongList,
  globals: mobile.globals,
  name: "Длинный список · телефон",
  play: async ({ canvasElement }) => {
    await expect(
      within(
        routeContent(canvasElement).getByRole("list", {
          name: "Люди, новые сверху",
        }),
      ).getAllByRole("listitem"),
    ).toHaveLength(25);
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Filtered: Story = {
  args: { query: filteredQuery, state: peopleState([annaRow]) },
  globals: desktop.globals,
  name: "Фильтры применены",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("searchbox", {
        name: "Поиск по имени, @username, email или ID",
      }),
    ).toHaveValue("петрова");
    const chips = page.getByRole("list", { name: "Применённые фильтры" });
    await expect(
      within(chips)
        .getAllByRole("listitem")
        .map((chip) => chip.textContent),
    ).toEqual([storyProducts[1].name, "Выдача владельцем", "Доступ отозван"]);
    await expect(page.getByText("Найдено: 1 человек")).toBeVisible();
    await userEvent.click(
      page.getByRole("button", { name: "Убрать фильтр «Выдача владельцем»" }),
    );
    await expect(queryChanged).toHaveBeenLastCalledWith({
      productId: storyProducts[1].productId,
      search: "петрова",
      state: "revoked",
    });
    await userEvent.click(page.getByRole("button", { name: "Сбросить" }));
    await expect(queryChanged).toHaveBeenLastCalledWith({});
  },
};

export const FilteredMobile: Story = {
  ...Filtered,
  globals: mobile.globals,
  name: "Фильтры применены · телефон",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const NameSearchUnavailable: Story = {
  args: {
    query: { search: "Анна" },
    state: peopleState([], { nameSearch: "unavailable", total: 0 }),
  },
  globals: desktop.globals,
  name: "Поиск по имени временно недоступен",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByText(/Поиск по имени и @username временно недоступен/u),
    ).toBeVisible();
    await expect(page.queryByText("Никого не нашли")).toBeNull();
  },
};

export const NameSearchUnavailableMobile: Story = {
  ...NameSearchUnavailable,
  globals: mobile.globals,
  name: "Поиск по имени недоступен · телефон",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const NameSearchTruncated: Story = {
  args: {
    query: { search: "Мария" },
    state: peopleState(storyPeopleRows(3), {
      nameSearch: "truncated",
      nextCursor: null,
      total: 3,
    }),
  },
  globals: desktop.globals,
  name: "Показаны не все совпадения",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByText("Показаны не все совпадения поиска. Уточните запрос."),
    ).toBeVisible();
    // Совпало больше людей, чем вмещает ответ, а фильтры оставили троих: число не преувеличено.
    await expect(page.getByText("3 человека", { exact: true })).toBeVisible();
    await expect(page.queryByText(/Больше 50/u)).toBeNull();
  },
};

export const NameSearchTruncatedMobile: Story = {
  ...NameSearchTruncated,
  globals: mobile.globals,
  name: "Совпадений по имени больше 50 · телефон",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Empty: Story = {
  args: { state: peopleState([]) },
  globals: desktop.globals,
  name: "Людей ещё нет",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Людей пока нет" }),
    ).toBeVisible();
    await expect(page.queryByRole("searchbox")).toBeNull();
  },
};

export const EmptyMobile: Story = {
  ...Empty,
  globals: mobile.globals,
  name: "Людей ещё нет · телефон",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const NoResults: Story = {
  args: { query: filteredQuery, state: peopleState([]) },
  globals: desktop.globals,
  name: "Никого не нашли",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(
      page.getByRole("button", { name: "Сбросить фильтры" }),
    );
    await expect(queryChanged).toHaveBeenLastCalledWith({});
  },
};

export const NoResultsMobile: Story = {
  ...NoResults,
  globals: mobile.globals,
  name: "Никого не нашли · телефон",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const StaleCursor: Story = {
  args: {
    query: { cursor: "o:75", state: "active" },
    state: { kind: "invalid_query" },
  },
  globals: desktop.globals,
  name: "Страница списка устарела",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Страница списка устарела" }),
    ).toBeVisible();
    await expect(page.queryByRole("button", { name: "Повторить" })).toBeNull();
    await userEvent.click(
      page.getByRole("button", { name: "К началу списка" }),
    );
    await expect(queryChanged).toHaveBeenLastCalledWith({ state: "active" });
  },
};

export const StaleCursorMobile: Story = {
  ...StaleCursor,
  globals: mobile.globals,
  name: "Страница списка устарела · телефон",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Keyboard: Story = {
  globals: desktop.globals,
  name: "Список · клавиатура",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    within(canvasElement).getByRole("main").focus();
    await userEvent.tab();
    await expect(
      page.getByRole("searchbox", {
        name: "Поиск по имени, @username, email или ID",
      }),
    ).toHaveFocus();
    await userEvent.tab();
    await expect(page.getByRole("combobox", { name: "Продукт" })).toHaveFocus();
  },
};

export const Unavailable: Story = {
  args: { state: { kind: "unavailable", reference: "dependency_unavailable" } },
  globals: desktop.globals,
  name: "Сервис недоступен",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("alert")).toHaveTextContent(
      "Код обращения: dependency_unavailable",
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

export const Forbidden: Story = {
  args: { state: { kind: "forbidden" } },
  globals: desktop.globals,
  name: "Нет доступа",
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("heading", {
        name: "Нет доступа к людям",
      }),
    ).toBeVisible();
  },
};

export const SignedOut: Story = {
  args: { state: { kind: "signed_out" } },
  globals: desktop.globals,
  name: "Нужен вход",
};

export const Loading: Story = {
  globals: desktop.globals,
  name: "Загрузка",
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("main", {
        name: "Загрузка списка людей",
      }),
    ).toHaveAttribute("aria-busy", "true");
  },
  render: () => <AuthoringPeopleLoading />,
};

export const LoadingMobile: Story = {
  ...Loading,
  globals: mobile.globals,
  name: "Загрузка · телефон",
};

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
    if (url.pathname === "/api/authoring/people/product-choices")
      return Response.json(catalog);
    if (url.pathname === "/api/authoring/people") {
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
      await expect(
        routeContent(canvasElement).getByRole("status"),
      ).toHaveTextContent("Загружаем людей");
      const measure = () => ({
        header: boxOf(canvasElement, "[data-authoring-people-frame] header"),
        filters: originOf(boxOf(canvasElement, ".admin-filter-bar")),
        table: originOf(
          boxOf(
            canvasElement,
            "[data-authoring-people-list] .admin-table-root",
          ),
        ),
      });
      const skeleton = measure();
      deliverList();
      await expect(
        await within(canvasElement).findByText("134 человека"),
      ).toBeVisible();
      await expect(measure()).toEqual(skeleton);
    },
    render: () => <AuthoringPeoplePage />,
  };
}

export const LoadsInPlace: Story = loadsInPlace(desktop);
export const LoadsInPlaceMobile: Story = loadsInPlace(mobile);
