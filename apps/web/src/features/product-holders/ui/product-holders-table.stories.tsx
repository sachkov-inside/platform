import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { internalRoute } from "@/shared/routing/internal-route";
import { touchTarget } from "@/shared/ui/admin/admin.fixtures";
import { desktop, mobile } from "@/storybook/loads-in-place";
import { authoringPageEnvironment } from "@/storybook/story-environment";

import {
  holdersAddressSearch,
  type HoldersAddress,
} from "../model/product-holders";
import {
  storyAccountId,
  storyHolders,
  storyProductPath,
} from "./product-holders.fixtures";
import { ProductHoldersTable } from "./product-holders-table.client";

const environment = authoringPageEnvironment(storyProductPath);
const addressChanged = fn();
const retried = fn();
const grantOpened = fn();

const hrefFor = (address: HoldersAddress) =>
  internalRoute(
    `${storyProductPath}${holdersAddressSearch("tab=learners", address)}`,
  );

const meta = {
  ...environment,
  title: "Pages/Authoring/Продукт/Ученики",
  component: ProductHoldersTable,
  args: {
    state: { kind: "ready", items: storyHolders(1), nextCursor: null },
    address: {},
    hrefFor,
    onAddressChange: addressChanged,
    onRetry: retried,
    onGrant: grantOpened,
  },
  beforeEach: () => {
    addressChanged.mockClear();
    retried.mockClear();
    grantOpened.mockClear();
    return environment.beforeEach();
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Вкладка «Ученики» страницы продукта: обладатели с прогрессом и последней активностью, фильтр по доступу и страницы в адресе. Отказ в праве показан отказом, а не пустым списком. Storybook передаёт состояние чтения напрямую.",
      },
    },
  },
} satisfies Meta<typeof ProductHoldersTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneLearnerDesktop: Story = {
  globals: desktop.globals,
  name: "Один ученик · широкий экран",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    const table = page.getByRole("table", { name: "Ученики продукта" });
    await expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "Ученик",
      "Доступ",
      "Получен",
      "Прогресс",
      "Начал обучение",
      "Последняя активность",
    ]);
    await expect(
      within(table).getByRole("link", {
        name: `Аккаунт ${storyAccountId(0).slice(0, 8)}`,
      }),
    ).toHaveAttribute("href", `/authoring/people/${storyAccountId(0)}`);
    await expect(within(table).getByText("Доступ есть")).toBeVisible();
    await expect(within(table).getByText("0 из 40")).toBeVisible();
    // Получен и начал обучение в один день.
    await expect(within(table).getAllByText("24 окт. 2026")).toHaveLength(2);
    await expect(page.queryByText(storyAccountId(0))).toBeNull();
    await expect(
      page.queryByRole("navigation", { name: "Страницы учеников" }),
    ).toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Выдать продукт" }));
    await expect(grantOpened).toHaveBeenCalledOnce();
  },
};

export const OneLearnerMobile: Story = {
  ...OneLearnerDesktop,
  globals: mobile.globals,
  name: "Один ученик · телефон",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    const list = page.getByRole("list", { name: "Ученики продукта" });
    const item = within(list).getByRole("listitem");
    await expect(within(item).getByText("Получен 24 окт. 2026")).toBeVisible();
    await expect(within(item).getByText("0 из 40")).toBeVisible();
    await expect(page.queryByRole("table")).toBeNull();
    await expect(document.documentElement.scrollWidth).toBe(
      document.documentElement.clientWidth,
    );
    await expect(
      touchTarget(page.getByRole("button", { name: "Выдать продукт" })).height,
    ).toBeGreaterThanOrEqual(44);
  },
};

const longList = {
  state: {
    kind: "ready",
    items: storyHolders(20),
    nextCursor: "page_2-cursor",
  },
  address: { cursor: "page_1-cursor" },
} as const;

export const LongListDesktop: Story = {
  args: longList,
  globals: desktop.globals,
  name: "Длинный список · широкий экран",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    const table = page.getByRole("table", { name: "Ученики продукта" });
    await expect(within(table).getAllByRole("row")).toHaveLength(21);
    await expect(within(table).getAllByText("Доступ отозван")).toHaveLength(2);
    await expect(within(table).getAllByText("Не начал").length).toBeGreaterThan(
      0,
    );
    await expect(within(table).getByText("Не указан")).toBeVisible();
    const pages = page.getByRole("navigation", { name: "Страницы учеников" });
    await expect(
      within(pages).getByRole("link", { name: "Дальше" }),
    ).toHaveAttribute(
      "href",
      `${storyProductPath}?tab=learners&cursor=page_2-cursor`,
    );
    await expect(
      within(pages).getByRole("link", { name: "В начало списка" }),
    ).toHaveAttribute("href", `${storyProductPath}?tab=learners`);
  },
};

export const LongListMobile: Story = {
  args: longList,
  globals: mobile.globals,
  name: "Длинный список · телефон",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    const list = page.getByRole("list", { name: "Ученики продукта" });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(20);
    await expect(document.documentElement.scrollWidth).toBe(
      document.documentElement.clientWidth,
    );
  },
};

export const EmptyDesktop: Story = {
  args: { state: { kind: "ready", items: [], nextCursor: null } },
  globals: desktop.globals,
  name: "Учеников пока нет · широкий экран",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    const empty = page.getByRole("heading", { name: "Учеников пока нет" });
    await expect(empty).toBeVisible();
    const section = empty.closest("section");
    if (section === null) throw new Error("Пустое состояние без раздела");
    await userEvent.click(
      within(section).getByRole("button", { name: "Выдать продукт" }),
    );
    await expect(grantOpened).toHaveBeenCalledOnce();
  },
};

export const EmptyMobile: Story = {
  ...EmptyDesktop,
  globals: mobile.globals,
  name: "Учеников пока нет · телефон",
};

export const NoResultsDesktop: Story = {
  args: {
    state: { kind: "ready", items: [], nextCursor: null },
    address: { access: "revoked" },
  },
  globals: desktop.globals,
  name: "Фильтр ничего не нашёл · широкий экран",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Никого не найдено" }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Применённые фильтры" }),
    ).toHaveTextContent("Доступ отозван");
    await userEvent.click(
      page.getByRole("button", { name: "Сбросить фильтры" }),
    );
    await expect(addressChanged).toHaveBeenCalledWith({});
  },
};

export const RefusedDesktop: Story = {
  args: { state: { kind: "forbidden" } },
  globals: desktop.globals,
  name: "Нет права · широкий экран",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Нет права на просмотр учеников" }),
    ).toBeVisible();
    await expect(page.queryByText("Учеников пока нет")).toBeNull();
    await expect(
      page.queryByRole("button", { name: "Выдать продукт" }),
    ).toBeNull();
  },
};

export const RefusedMobile: Story = {
  ...RefusedDesktop,
  globals: mobile.globals,
  name: "Нет права · телефон",
};

export const ErrorDesktop: Story = {
  args: { state: { kind: "unavailable", reference: "c0ffee42" } },
  globals: desktop.globals,
  name: "Ошибка чтения · широкий экран",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    const alert = page.getByRole("alert");
    await expect(alert).toHaveTextContent("Не удалось загрузить учеников");
    await expect(alert).toHaveTextContent("Код обращения: c0ffee42");
    await userEvent.click(
      within(alert).getByRole("button", { name: "Повторить" }),
    );
    await expect(retried).toHaveBeenCalledOnce();
  },
};

export const ErrorMobile: Story = {
  ...ErrorDesktop,
  globals: mobile.globals,
  name: "Ошибка чтения · телефон",
};

export const LoadingDesktop: Story = {
  args: { state: { kind: "loading" } },
  globals: desktop.globals,
  name: "Загрузка · широкий экран",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(
      page.getByText("Загружаем учеников", { selector: "span" }),
    ).toBeInTheDocument();
    await expect(
      page.queryByRole("table", { name: "Ученики продукта" }),
    ).toBeNull();
  },
};

export const LoadingMobile: Story = {
  ...LoadingDesktop,
  globals: mobile.globals,
  name: "Загрузка · телефон",
};
