import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadonlyURLSearchParams, useSearchParams } from "next/navigation";
import { expect, mocked, within } from "storybook/test";

import { desktop, mobile } from "@/storybook/loads-in-place";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import {
  forgetSalesCatalogQueries,
  salesCatalogFetch,
  storyArchivedPromotions,
  storyPromotions,
  type SalesCatalogFixture,
} from "@/storybook/sales-catalog.fixtures";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { SalesDiscountsPage } from "./sales-discounts-page";

const environment = authoringPageEnvironment("/authoring/sales/discounts");

/** История ставит ответы BFF и адрес страницы до первого рендера. */
function scenario(fixture: SalesCatalogFixture, search = "") {
  return () => {
    const restoreEnvironment = environment.beforeEach();
    forgetSalesCatalogQueries();
    mocked(useSearchParams).mockReturnValue(
      new ReadonlyURLSearchParams(search),
    );
    const restoreFetch = fetchBeforeRender(salesCatalogFetch(fixture))();
    return () => {
      restoreFetch();
      restoreEnvironment?.();
    };
  };
}

const fullFixture: SalesCatalogFixture = {
  promotions: storyPromotions,
  archivedPromotions: storyArchivedPromotions,
};

const meta = {
  ...environment,
  title: "Pages/Authoring/Sales/Discounts",
  component: SalesDiscountsPage,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "«Скидки» (`/authoring/sales/discounts`): Promotion владельца с продуктами, периодом по Москве, промокодом, процентом и применениями; создание и изменение формой, архив из «⋯». Пустой список продуктов значит «Все продукты», а прежняя область (`legacy`) показана отдельно и только для чтения. «Анкетные скидки» (`?view=questionnaire`) только для чтения.",
      },
    },
  },
} satisfies Meta<typeof SalesDiscountsPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyDesktop: Story = {
  beforeEach: scenario({ promotions: [] }),
  globals: desktop.globals,
  name: "Пусто · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("heading", { name: "Скидок пока нет" }),
    ).toBeVisible();
  },
};

export const EmptyMobile: Story = {
  ...EmptyDesktop,
  globals: mobile.globals,
  name: "Пусто · телефон",
};

export const ListDesktop: Story = {
  beforeEach: scenario(fullFixture),
  globals: desktop.globals,
  name: "Список · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const table = await page.findByRole("table", { name: "Скидки" });
    await expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "Название",
      "Продукты",
      "Период",
      "Скидка",
      "Применения",
      "Состояние",
      "Действия",
    ]);
    await expect(within(table).getByText("Все продукты")).toBeVisible();
    await expect(within(table).getByText("ещё 1")).toBeVisible();
    await expect(within(table).getByText("Лимит исчерпан")).toBeVisible();
    await expect(within(table).getByText("Запланирована")).toBeVisible();
    await expect(within(table).getByText("Завершилась")).toBeVisible();
    await expect(within(table).getByText("12 из 50")).toBeVisible();
  },
};

export const ListMobile: Story = {
  beforeEach: scenario(fullFixture),
  globals: mobile.globals,
  name: "Список · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const list = await page.findByRole("list", { name: "Скидки" });
    await expect(within(list).getByText("Скидка выпускникам")).toBeVisible();
    await expect(
      document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ).toBe(true);
  },
};

/** Архив: прежняя область только для чтения и архивная скидка на все продукты. */
export const ArchiveDesktop: Story = {
  beforeEach: scenario(fullFixture, "archived=1"),
  globals: desktop.globals,
  name: "Архив · прежняя область и все продукты",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const table = await page.findByRole("table", { name: "Скидки" });
    await expect(within(table).getByText("Прежние предложения")).toBeVisible();
    await expect(within(table).getByText("Все продукты")).toBeVisible();
  },
};

export const ArchiveMobile: Story = {
  beforeEach: scenario(fullFixture, "archived=1"),
  globals: mobile.globals,
  name: "Архив · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const list = await page.findByRole("list", { name: "Скидки" });
    await expect(within(list).getByText(/Прежние предложения/u)).toBeVisible();
  },
};

export const QuestionnaireDesktop: Story = {
  beforeEach: scenario(fullFixture, "view=questionnaire"),
  globals: desktop.globals,
  name: "Анкетные скидки · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("table", { name: "Респонденты анкеты" }),
    ).toBeVisible();
    await expect(
      page.queryByRole("button", { name: "Создать скидку" }),
    ).not.toBeInTheDocument();
    await expect(
      page.getByRole("navigation", { name: "Страницы респондентов" }),
    ).toBeVisible();
  },
};

export const QuestionnaireMobile: Story = {
  beforeEach: scenario(fullFixture, "view=questionnaire"),
  globals: mobile.globals,
  name: "Анкетные скидки · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("list", { name: "Респонденты анкеты" }),
    ).toBeVisible();
  },
};

export const Unavailable: Story = {
  beforeEach: scenario({ unavailable: true }),
  globals: desktop.globals,
  name: "Ошибка чтения",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("heading", { name: "Не удалось загрузить скидки" }),
    ).toBeVisible();
  },
};

export const Loading: Story = {
  beforeEach: scenario({ held: true }),
  globals: mobile.globals,
  name: "Загрузка · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(await page.findAllByText("Загружаем скидки")).not.toHaveLength(
      0,
    );
  },
};
