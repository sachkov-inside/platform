import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import {
  PaymentsTableView,
  type PaymentsListState,
} from "@/features/owner-payments/ui/payments-table.client";
import type { ProductChoices } from "@/features/owner-payments/ui/product-filter.client";
import type { PaymentsQuery } from "@/features/owner-payments";
import { desktop, mobile } from "@/storybook/loads-in-place";
import {
  ownerPayment,
  ownerPayments,
  paymentProducts,
} from "@/storybook/owner-payments.fixtures";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { SalesPaymentsFrame } from "./sales-payments-frame";
import { SalesPaymentsLoading } from "./sales-payments-loading";

const environment = authoringPageEnvironment("/authoring/sales/payments");
const products: ProductChoices = { kind: "ready", items: paymentProducts };
const queryChanged = fn();
const retried = fn();

function ready(
  count: number,
  nextCursor: string | null = null,
): PaymentsListState {
  return {
    kind: "ready",
    value: { items: ownerPayments(count), nextCursor },
  };
}

interface Args {
  readonly state: PaymentsListState;
  readonly query: PaymentsQuery;
}

/** Страница «Платежи» в своём каркасе: тот же модуль списка, что на маршруте. */
function PaymentsPage({ state, query }: Args) {
  return (
    <SalesPaymentsFrame>
      <PaymentsTableView
        onQueryChange={queryChanged}
        onRetry={retried}
        products={products}
        query={query}
        state={state}
      />
    </SalesPaymentsFrame>
  );
}

const meta = {
  ...environment,
  args: { state: ready(1), query: { states: [] } },
  beforeEach: () => {
    queryChanged.mockClear();
    retried.mockClear();
    return environment.beforeEach();
  },
  component: PaymentsPage,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Платежи владельца (#1718): фильтры продукта, периода и состояния в адресе, таблица по общему образцу списков, на телефоне список. Маршрут читает список через browser-owned TanStack Query; Storybook передаёт готовое состояние.",
      },
    },
  },
  title: "Pages/Authoring/Платежи",
} satisfies Meta<typeof PaymentsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneSale: Story = {
  globals: desktop.globals,
  name: "Одна продажа · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const table = page.getByRole("table", { name: "Платежи" });
    await expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "Покупатель",
      "Продукт",
      "Сумма",
      "Состояние",
      "Время",
      "Действия",
    ]);
    await expect(within(table).getByText("19 900 ₽")).toBeVisible();
    await expect(within(table).getByText("Оплачен")).toBeVisible();
    await expect(within(table).getByText("Доступ открыт")).toBeVisible();
    await expect(
      within(table).getByRole("link", { name: "Покупатель 33333333" }),
    ).toHaveAttribute(
      "href",
      `/authoring/sales/payments/${ownerPayment(0).purchaseRef}`,
    );
    await expect(page.queryByText(ownerPayment(0).accountId)).toBeNull();
  },
};

export const OneSaleMobile: Story = {
  globals: mobile.globals,
  name: "Одна продажа · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.queryByRole("table")).toBeNull();
    const item = within(page.getByRole("list", { name: "Платежи" })).getByRole(
      "listitem",
    );
    await expect(within(item).getByText("19 900 ₽")).toBeVisible();
    await expect(within(item).getByText("Оплачен")).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBe(
      document.documentElement.clientWidth,
    );
  },
};

export const LongList: Story = {
  args: { state: ready(50, ownerPayment(50).purchaseRef) },
  globals: desktop.globals,
  name: "Длинный список · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      within(page.getByRole("table", { name: "Платежи" })).getAllByRole("row"),
    ).toHaveLength(51);
    await expect(
      page.getAllByText("Неизвестно, нужна сверка").length,
    ).toBeGreaterThan(0);
    await userEvent.click(page.getByRole("button", { name: "Более ранние" }));
    await expect(queryChanged).toHaveBeenCalledWith({
      states: [],
      cursor: ownerPayment(50).purchaseRef,
    });
  },
};

export const LongListMobile: Story = {
  ...LongList,
  globals: mobile.globals,
  name: "Длинный список · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      within(page.getByRole("list", { name: "Платежи" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(50);
  },
};

const filteredQuery: PaymentsQuery = {
  states: ["unknown", "failed"],
  productId: paymentProducts[1]?.id ?? "",
  from: "2026-10-01",
  to: "2026-10-20",
};

export const FilteredNoResults: Story = {
  args: {
    query: filteredQuery,
    state: { kind: "ready", value: { items: [], nextCursor: null } },
  },
  globals: desktop.globals,
  name: "Ничего не найдено · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Платежи не найдены" }),
    ).toBeVisible();
    await expect(
      within(page.getByRole("list", { name: "Применённые фильтры" }))
        .getAllByRole("listitem")
        .map((chip) => chip.textContent),
    ).toEqual([
      "Неизвестно, нужна сверка",
      "Не прошёл",
      "Разработка с агентами",
      "С 1 окт. 2026 по 20 окт. 2026",
    ]);
    await expect(page.getByRole("combobox", { name: "Продукт" })).toHaveValue(
      "Разработка с агентами",
    );
    await userEvent.click(
      page.getByRole("button", { name: "Сбросить фильтры" }),
    );
    await expect(queryChanged).toHaveBeenCalledWith({ states: [] });
  },
};

export const FilteredNoResultsMobile: Story = {
  ...FilteredNoResults,
  globals: mobile.globals,
  name: "Ничего не найдено · телефон",
};

export const Empty: Story = {
  args: { state: { kind: "ready", value: { items: [], nextCursor: null } } },
  globals: desktop.globals,
  name: "Платежей ещё нет · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Платежей пока нет" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Ссылки на оплату" }),
    ).toHaveAttribute("href", "/authoring/sales/links");
    await expect(page.queryByRole("table")).toBeNull();
  },
};

export const EmptyMobile: Story = {
  ...Empty,
  globals: mobile.globals,
  name: "Платежей ещё нет · телефон",
};

export const Unavailable: Story = {
  args: { state: { kind: "unavailable", reference: "dependency-unavailable" } },
  globals: desktop.globals,
  name: "Ошибка · широкий экран",
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
  name: "Ошибка · телефон",
};

export const Forbidden: Story = {
  args: { state: { kind: "forbidden" } },
  globals: desktop.globals,
  name: "Нет права",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Нет доступа к платежам" }),
    ).toBeVisible();
    await expect(page.queryByText("Платежей пока нет")).toBeNull();
  },
};

export const Loading: Story = {
  globals: desktop.globals,
  name: "Загрузка · широкий экран",
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("main", { name: "Платежи" }),
    ).toHaveAttribute("aria-busy", "true");
    await expect(
      routeContent(canvasElement).getByRole("status"),
    ).toHaveTextContent("Загружаем платежи");
  },
  render: () => <SalesPaymentsLoading />,
};

export const LoadingMobile: Story = {
  ...Loading,
  globals: mobile.globals,
  name: "Загрузка · телефон",
};
