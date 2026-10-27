import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadonlyURLSearchParams, useSearchParams } from "next/navigation";
import { Suspense, use } from "react";
import { expect, mocked, userEvent, waitFor, within } from "storybook/test";

import {
  MaterialAuthoringSignInActions,
  MaterialAuthoringUnauthorizedState,
} from "@/widgets/material-authoring/route-states";
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
import { getQueryClient } from "@/shared/api/query-client";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import {
  catalogSaleResponse,
  preorderState,
  runningPrice,
  runningState,
  type CatalogSaleFake,
} from "@/storybook/product-sale.fixtures";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { ContentCollectionsLoading } from "./content-collections-loading.client";
import { ContentCollectionsPageClient } from "./content-collections-page.client";
import { ContentCollectionsUnavailable } from "./content-collections-unavailable";
import type { ContentCollection } from "../model/content-collections";

const product = {
  archived: false,
  cover: {
    coverId: "27100000-0000-4000-8000-000000000002",
    renditions: [{ height: 540, width: 960 }],
  },
  id: "97000000-0000-4000-8000-000000000003",
  introduction: null,
  kind: "product",
  materialCount: 4,
  publishedMaterialCount: 2,
  holderCount: 1240,
  name: "Demo · От проекта до первого релиза",
  slug: "demo-first-release",
  summary:
    "Учебный пример продукта: собираем приложение, готовим окружение и проверяем первый релиз.",
  version: 1,
} as const satisfies ContentCollection;

const products: readonly ContentCollection[] = [
  {
    ...product,
    cover: null,
    id: "97000000-0000-4000-8000-000000000008",
    name: "Demo · Архитектура приложения",
    slug: "demo-architecture",
    materialCount: 8,
    publishedMaterialCount: 4,
    holderCount: 128,
  },
  {
    ...product,
    cover: null,
    id: "97000000-0000-4000-8000-000000000010",
    name: "Demo · Архивное руководство по развёртыванию прежней версии",
    slug: "demo-archived",
    archived: true,
    publishedMaterialCount: 0,
    holderCount: 3,
  },
  product,
  {
    ...product,
    cover: null,
    id: "97000000-0000-4000-8000-000000000011",
    name: "Demo · Наблюдаемость, метрики и спокойный разбор инцидентов в продакшене",
    slug: "demo-observability-and-incident-review-in-production",
    materialCount: 15,
    publishedMaterialCount: 12,
    holderCount: 0,
  },
  {
    ...product,
    cover: null,
    id: "97000000-0000-4000-8000-000000000009",
    name: "Demo · Работа с базой данных",
    slug: "demo-database",
    materialCount: 12,
    publishedMaterialCount: 6,
    holderCount: null,
  },
];

function longProductList(size: number): ContentCollection[] {
  return Array.from({ length: size }, (_, index) => ({
    ...product,
    cover: index % 3 === 0 ? product.cover : null,
    archived: index % 9 === 8,
    id: `97000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    name: `Курс ${String(index + 1).padStart(2, "0")} · Практика командной разработки`,
    slug: `course-${String(index + 1)}`,
    publishedMaterialCount: index % 7,
  }));
}

/**
 * Продажи каталога: поток идёт, предзаказ, продажи закрыты, без цены. Архивный продукт с ценой
 * всё равно показан «Архивом».
 */
const catalogSale: CatalogSaleFake = {
  prices: {
    [product.id]: runningPrice,
    "97000000-0000-4000-8000-000000000008": runningPrice,
    "97000000-0000-4000-8000-000000000010": runningPrice,
    "97000000-0000-4000-8000-000000000011": {
      ...runningPrice,
      published: false,
    },
  },
  salesStates: [
    { ...preorderState, productId: product.id },
    { ...runningState, productId: "97000000-0000-4000-8000-000000000008" },
  ],
};

let pinnedId: string | null = product.id;
let pinVersion = 1;

/** BFF списка: закреп на главной, продажи каталога и запись коллекции. */
function productsBff(sale: Partial<CatalogSaleFake> = {}) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const saleResponse = catalogSaleResponse(input, {
      ...catalogSale,
      ...sale,
    });
    if (saleResponse !== null) return saleResponse;
    const path = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    ).pathname;
    if (path === "/api/authoring/home-pin" && init?.method === "PUT") {
      const raw = init.body;
      const body: unknown = typeof raw === "string" ? JSON.parse(raw) : null;
      const productId =
        typeof body === "object" && body !== null && "productId" in body
          ? body.productId
          : null;
      pinnedId = typeof productId === "string" ? productId : null;
      pinVersion += 1;
      return Response.json({
        kind: "ready",
        pin: { productId: pinnedId, version: pinVersion },
      });
    }
    if (path === "/api/authoring/home-pin")
      return Response.json({
        kind: "ready",
        pin: { productId: pinnedId, version: pinVersion },
      });
    return Response.json({ kind: "saved", collection: product });
  };
}

/** Раздел «Продукты»: навигация ведёт на `/authoring/products`, маршрут рендерит список продуктов. */
const environment = authoringPageEnvironment("/authoring/products");

const meta = {
  ...environment,
  args: { initialCollections: products, kind: "product" },
  component: ContentCollectionsPageClient,
  beforeEach: [
    environment.beforeEach,
    () => {
      pinnedId = product.id;
      pinVersion = 1;
      // Общий клиент запросов Storybook помнит закреп прошлой истории; каждая читает его заново.
      getQueryClient().removeQueries({ queryKey: ["authoring-home-pin"] });
      getQueryClient().removeQueries({ queryKey: ["product-sale"] });
      getQueryClient().removeQueries({ queryKey: ["owner-price-catalog"] });
      return () => {
        mocked(useSearchParams).mockReturnValue(new ReadonlyURLSearchParams());
      };
    },
    fetchBeforeRender(productsBff()),
  ],
  decorators: environment.decorators,
  title: "Pages/Authoring/Продукты",
} satisfies Meta<typeof ContentCollectionsPageClient>;

export default meta;
type Story = StoryObj<typeof meta>;

function noHorizontalOverflow(canvasElement: HTMLElement) {
  const root = canvasElement.ownerDocument.documentElement;
  return expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
}

export const ProductsDesktop: Story = {
  globals: desktop.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Продукты" }),
    ).toBeVisible();
    await expect(page.getByText("5 продуктов")).toBeVisible();
    await expect(
      within(canvasElement)
        .getAllByRole("link", { name: "Продукты" })
        .some((link) => link.getAttribute("aria-current") === "page"),
    ).toBe(true);
    const table = page.getByRole("table", { name: "Все продукты" });
    await expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "Название",
      "Продажа",
      "Обладатели",
      "Опубликовано",
      "На главной",
      "Действия",
    ]);
    await expect(
      within(table).getByRole("link", { name: product.name }),
    ).toHaveAttribute("href", `/authoring/products/${product.id}`);
    await expect(
      await within(table).findByRole("button", {
        name: `Снять закреп «${product.name}»`,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(within(table).getAllByText("На главной")).toHaveLength(2);
    await expect(within(table).getByText("Архив")).toBeVisible();
    await waitFor(() =>
      expect(
        within(table)
          .getAllByRole("row")
          .slice(1)
          .map((row) => [
            row.querySelector("[data-state]")?.textContent ?? null,
            row.querySelectorAll("td")[2]?.textContent.replace(/\s+/gu, " "),
          ]),
      ).toEqual([
        ["Поток идёт", "128"],
        ["Архив", "3"],
        ["Предзаказ", "1 240"],
        ["Продажи закрыты", "0"],
        ["Нет цены", "Нет данных"],
      ]),
    );
    await noHorizontalOverflow(canvasElement);
  },
};

export const ProductsMobile: Story = {
  globals: mobile.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const button = page.getByRole("button", { name: "Создать продукт" });
    await expect(button).toBeVisible();
    const bounds = button.getBoundingClientRect();
    await expect(bounds.left).toBeGreaterThanOrEqual(0);
    await expect(bounds.right).toBeLessThanOrEqual(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
    const list = page.getByRole("list", { name: "Все продукты" });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    await expect(page.queryByRole("table")).toBeNull();
    await expect(
      within(list).getByText("1 240 обладателей · опубликовано 2"),
    ).toBeVisible();
    await expect(within(list).getByText("Опубликовано: 6")).toBeVisible();
    await expect(await within(list).findByText("Предзаказ")).toBeVisible();
    await noHorizontalOverflow(canvasElement);
  },
};

/** Поиск по названию и фильтр архива сужают полный список, «Сбросить» возвращает его. */
export const SearchAndArchiveFilter: Story = {
  globals: desktop.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.type(
      page.getByRole("searchbox", { name: "Поиск по продуктам" }),
      "базой",
    );
    const table = page.getByRole("table", { name: "Все продукты" });
    await expect(within(table).getAllByRole("row")).toHaveLength(2);
    await expect(page.getByText("Найдено: 1 продукт")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Сбросить" }));
    await expect(within(table).getAllByRole("row")).toHaveLength(6);
    await expect(
      page.getByRole("searchbox", { name: "Поиск по продуктам" }),
    ).toHaveValue("");
  },
};

/** Адрес `?state=archived&search=…` открывает список уже отфильтрованным, с плашкой фильтра. */
export const FilteredFromAddress: Story = {
  globals: mobile.globals,
  beforeEach: () => {
    mocked(useSearchParams).mockReturnValue(
      new ReadonlyURLSearchParams("state=archived&search=Demo"),
    );
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("searchbox", { name: "Поиск по продуктам" }),
    ).toHaveValue("Demo");
    const chips = page.getByRole("list", { name: "Применённые фильтры" });
    await expect(chips).toHaveTextContent("Архив");
    const list = page.getByRole("list", { name: "Все продукты" });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    await userEvent.click(
      page.getByRole("button", { name: "Убрать фильтр «Архив»" }),
    );
    await expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    await noHorizontalOverflow(canvasElement);
  },
};

export const NoResults: Story = {
  globals: desktop.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.type(
      page.getByRole("searchbox", { name: "Поиск по продуктам" }),
      "Нет такого продукта",
    );
    await expect(
      page.getByRole("heading", { name: "Ничего не найдено" }),
    ).toBeVisible();
    await expect(page.queryByRole("table")).toBeNull();
    await userEvent.click(
      page.getByRole("button", { name: "Сбросить фильтры" }),
    );
    await expect(
      page.getByRole("table", { name: "Все продукты" }),
    ).toBeVisible();
  },
};

/** Закреп на главной: единственное прямое действие строки, плашка переходит к новому продукту. */
export const PinFromList: Story = {
  globals: desktop.globals,
  play: async ({ canvasElement }) => {
    const table = within(
      routeContent(canvasElement).getByRole("table", { name: "Все продукты" }),
    );
    const name = "Demo · Работа с базой данных";
    const pin = await table.findByRole("button", {
      name: `Закрепить «${name}» на главной`,
    });
    await waitFor(() => expect(pin).toBeEnabled());
    await userEvent.click(pin);
    await expect(
      await table.findByRole("button", { name: `Снять закреп «${name}»` }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      table.getByRole("button", {
        name: `Закрепить «${product.name}» на главной`,
      }),
    ).toHaveAttribute("aria-pressed", "false");
    // Архивный продукт закрепить нельзя: сначала его возвращают из архива.
    await expect(
      table.getByRole("button", {
        name: "Закрепить «Demo · Архивное руководство по развёртыванию прежней версии» на главной",
      }),
    ).toBeDisabled();
  },
};

/** «⋯» ведёт сразу в нужную вкладку страницы продукта. */
export const RowMenuOpensProductTabs: Story = {
  globals: mobile.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(
      page.getByRole("button", { name: `Действия с «${product.name}»` }),
    );
    const menu = await within(canvasElement.ownerDocument.body).findByRole(
      "menu",
    );
    await expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Обзор",
      "Программа",
      "Описание и витрина",
      "Продажа",
      "Ученики",
      "Сообщество и активация",
    ]);
    await expect(
      within(menu).getByRole("menuitem", { name: "Описание и витрина" }),
    ).toHaveAttribute(
      "href",
      `/authoring/products/${product.id}?tab=description`,
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        within(canvasElement.ownerDocument.body).queryByRole("menu"),
      ).toBeNull(),
    );
  },
};

/** Закреп не прочитан: строка над таблицей предлагает обновить его, таблица остаётся на месте. */
export const PinUnavailable: Story = {
  globals: desktop.globals,
  beforeEach: fetchBeforeRender(() =>
    Promise.resolve(Response.json({}, { status: 503 })),
  ),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("button", { name: "Обновить закреп" }),
    ).toBeEnabled();
    await expect(page.getByRole("alert")).toHaveTextContent(
      "Закреп временно недоступен",
    );
  },
};

/**
 * Цены владельца не прочитаны (нет права или сбой): колонка показывает публичный этап продажи или
 * «Неизвестно», но не «Нет цены» и не «Продажи закрыты».
 */
export const SaleWithoutOwnerPrices: Story = {
  globals: desktop.globals,
  beforeEach: fetchBeforeRender(productsBff({ pricesFailure: "forbidden" })),
  play: async ({ canvasElement }) => {
    const table = within(
      routeContent(canvasElement).getByRole("table", { name: "Все продукты" }),
    );
    await expect(await table.findByText("Предзаказ")).toBeVisible();
    await expect(table.getByText("Поток идёт")).toBeVisible();
    await expect(table.getByText("Архив")).toBeVisible();
    await expect(table.getAllByText("Неизвестно")).toHaveLength(2);
    await expect(table.queryByText("Нет цены")).toBeNull();
    await expect(table.queryByText("Продажи закрыты")).toBeNull();
  },
};

export const SaleWithoutOwnerPricesMobile: Story = {
  ...SaleWithoutOwnerPrices,
  globals: mobile.globals,
  play: async ({ canvasElement }) => {
    const list = within(
      routeContent(canvasElement).getByRole("list", { name: "Все продукты" }),
    );
    await expect(await list.findByText("Предзаказ")).toBeVisible();
    await expect(list.queryByText("Нет цены")).toBeNull();
    await noHorizontalOverflow(canvasElement);
  },
};

/** Продажи каталога ещё читаются: архив уже назван, у остальных заглушка, а не «Неизвестно». */
export const SaleLoading: Story = {
  globals: desktop.globals,
  beforeEach: fetchBeforeRender(productsBff({ pending: true })),
  play: async ({ canvasElement }) => {
    const table = within(
      routeContent(canvasElement).getByRole("table", { name: "Все продукты" }),
    );
    await expect(table.getByText("Архив")).toBeVisible();
    await expect(table.getAllByText("Загружаем продажу")).toHaveLength(4);
    await expect(table.queryByText("Неизвестно")).toBeNull();
  },
};

export const SingleProduct: Story = {
  args: { initialCollections: [product] },
  globals: mobile.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByText("1 продукт")).toBeVisible();
    await expect(
      within(page.getByRole("list", { name: "Все продукты" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(1);
  },
};

/** 64 продукта: по 50 строк на страницу, номер страницы в адресе. */
export const LongList: Story = {
  args: { initialCollections: longProductList(64) },
  globals: desktop.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const table = page.getByRole("table", { name: "Все продукты" });
    await expect(within(table).getAllByRole("row")).toHaveLength(51);
    await expect(page.getByText("1–50 из 64")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: /^Следующая/u }));
    await expect(within(table).getAllByRole("row")).toHaveLength(15);
    await expect(page.getByText("51–64 из 64")).toBeVisible();
    await noHorizontalOverflow(canvasElement);
  },
};

export const LongListMobile: Story = {
  ...LongList,
  globals: mobile.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const list = page.getByRole("list", { name: "Все продукты" });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(50);
    await noHorizontalOverflow(canvasElement);
  },
};

export const Empty: Story = {
  args: { initialCollections: [] },
  globals: desktop.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Продуктов пока нет" }),
    ).toBeVisible();
    await expect(page.queryByRole("searchbox")).toBeNull();
    await userEvent.click(
      page.getByRole("button", { name: "Создать продукт" }),
    );
    await expect(
      page.getByRole("region", { name: "Создать продукт" }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Название" })).toBeVisible();
  },
};

export const EmptyMobile: Story = {
  ...Empty,
  globals: mobile.globals,
};

/** Сессия не подтверждена: страница маршрута показывает экран входа с возвратом к продуктам. */
export const SignedOut: Story = {
  render: () => (
    <MaterialAuthoringUnauthorizedState
      action={
        <MaterialAuthoringSignInActions returnHref="/authoring/products" />
      }
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
  globals: desktop.globals,
  render: () => (
    <ContentCollectionsUnavailable
      kind="product"
      reference="collections-read"
    />
  ),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Список временно недоступен" }),
    ).toBeVisible();
    await expect(
      page.getByText("Код обращения: collections-read"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  },
};

export const UnavailableMobile: Story = {
  ...Unavailable,
  globals: mobile.globals,
};

function ArrivedProducts({ sequence }: { readonly sequence: StagedLoading }) {
  use(sequence.sharedPart);
  return (
    <ContentCollectionsPageClient
      initialCollections={products}
      kind="product"
    />
  );
}

function loadsInPlace({ globals, width }: StoryViewport): Story {
  return {
    globals,
    loaders: stagedLoaders,
    render: (_args, { loaded }) => (
      <Suspense fallback={<ContentCollectionsLoading kind="product" />}>
        <ArrivedProducts sequence={stagedLoadingOf(loaded)} />
      </Suspense>
    ),
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const page = routeContent(canvasElement);
      await expect(
        page.getByText("Загружаем продукты", { selector: "span" }),
      ).toBeInTheDocument();
      const anchors = () =>
        [".admin-list-header h1", ".admin-filter-bar", ".admin-table-root"].map(
          (selector) => originOf(boxOf(canvasElement, selector)),
        );
      const loading = anchors();
      stagedLoadingOf(loaded).deliverSharedPart();
      // Готовая страница приносит свой `main`: прежний ушёл вместе со скелетом.
      await within(canvasElement).findByRole(width < 768 ? "list" : "table", {
        name: "Все продукты",
      });
      await expect(anchors()).toEqual(loading);
    },
  };
}
export const LoadsInPlace: Story = loadsInPlace(desktop);
export const LoadsInPlaceMobile: Story = loadsInPlace(mobile);
