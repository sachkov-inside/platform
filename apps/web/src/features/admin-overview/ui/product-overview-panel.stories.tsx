import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { internalRoute } from "@/shared/routing/internal-route";
import {
  storyProductOverview,
  storyProductOverviewEmpty,
  storyProductOverviewUnavailable,
} from "@/storybook/admin-overview.fixtures";
import { desktop, mobile } from "@/storybook/loads-in-place";
import { authoringPageEnvironment } from "@/storybook/story-environment";

import type { ProductOverview } from "../model/product-overview";
import { ProductOverviewPanel } from "./product-overview-panel.client";

const productPath = "/authoring/products/97000000-0000-4000-8000-000000000301";

/**
 * Вкладка стоит в рамке страницы продукта, как на маршруте: `main` с `#authoring-content`
 * прокручивает страницу под каркасом с 48rem.
 */
function ProductPageFrame({ children }: { readonly children: ReactNode }) {
  return (
    <main className="authoring-page" id="authoring-content" tabIndex={-1}>
      <div className="authoring-page-body">{children}</div>
    </main>
  );
}

const environment = authoringPageEnvironment(productPath, {
  frame: ProductPageFrame,
});
const periodChanged = fn();
const retried = fn();

function ready(overview: ProductOverview) {
  return { kind: "ready" as const, ...overview };
}

const meta = {
  ...environment,
  title: "Pages/Authoring/Обзор продукта",
  component: ProductOverviewPanel,
  args: {
    state: ready(storyProductOverview()),
    period: 30,
    onPeriodChange: periodChanged,
    onRetry: retried,
    programHref: internalRoute(`${productPath}?tab=program`),
  },
  beforeEach: () => {
    periodChanged.mockClear();
    retried.mockClear();
    return environment.beforeEach();
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Вкладка «Обзор» страницы продукта (#1719): обладатели по способу получения, выручка и продажи за период со сравнением, список ожидания текущего набора, обучение и последние события продукта. Период живёт в адресе страницы (`?period=`).",
      },
    },
  },
} satisfies Meta<typeof ProductOverviewPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

async function expectNoHorizontalOverflow(canvasElement: HTMLElement) {
  const root = canvasElement.ownerDocument.documentElement;
  await waitFor(() => expect(root.scrollWidth).toBe(root.clientWidth));
}

export const Ready: Story = {
  globals: desktop.globals,
  name: "Продукт с продажами",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(page.getByText("Покупка: 121")).toBeVisible();
    await expect(page.getByText("Набор «Поток весна 2027»")).toBeVisible();
    await expect(page.getByText(/^46\s%$/u)).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "90 дней" }));
    await expect(periodChanged).toHaveBeenCalledWith(90);
  },
};

export const ReadyMobile: Story = {
  ...Ready,
  globals: mobile.globals,
  name: "Продукт с продажами · телефон",
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Empty: Story = {
  args: { state: ready(storyProductOverviewEmpty()) },
  globals: desktop.globals,
  name: "Новый продукт",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(page.getByText("Набор не открыт")).toBeVisible();
    await expect(page.getByText("Доступа пока ни у кого нет")).toBeVisible();
    await expect(page.getByText("Событий пока нет")).toBeVisible();
  },
};

export const EmptyMobile: Story = {
  ...Empty,
  globals: mobile.globals,
  name: "Новый продукт · телефон",
};

export const Unavailable: Story = {
  args: { state: ready(storyProductOverviewUnavailable()) },
  globals: desktop.globals,
  name: "Источники не ответили",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(page.getAllByText("Недоступно")).toHaveLength(4);
    await expect(page.getByText("События не загрузились")).toBeVisible();
  },
};

export const UnavailableMobile: Story = {
  ...Unavailable,
  globals: mobile.globals,
  name: "Источники не ответили · телефон",
};

export const MaterialsOnly: Story = {
  args: { state: { kind: "forbidden" } },
  globals: desktop.globals,
  name: "Автор только материалов",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(
      page.getByRole("link", { name: "Открыть программу" }),
    ).toHaveAttribute("href", `${productPath}?tab=program`);
    await expect(page.queryByRole("group", { name: /Период/u })).toBeNull();
  },
};

export const MaterialsOnlyMobile: Story = {
  ...MaterialsOnly,
  globals: mobile.globals,
  name: "Автор только материалов · телефон",
};

export const Failed: Story = {
  args: { state: { kind: "unavailable", reference: "product-overview-503" } },
  globals: mobile.globals,
  name: "Сбой чтения · телефон",
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Повторить" }),
    );
    await expect(retried).toHaveBeenCalledOnce();
  },
};

export const Loading: Story = {
  args: { state: { kind: "loading" } },
  globals: desktop.globals,
  name: "Загрузка",
};
