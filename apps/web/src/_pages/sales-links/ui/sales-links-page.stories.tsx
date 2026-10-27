import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadonlyURLSearchParams, useSearchParams } from "next/navigation";
import { expect, mocked, userEvent, within } from "storybook/test";

import { desktop, mobile } from "@/storybook/loads-in-place";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import {
  forgetSalesCatalogQueries,
  salesCatalogFetch,
  storyPaymentLinks,
  type SalesCatalogFixture,
} from "@/storybook/sales-catalog.fixtures";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { SalesLinksPage } from "./sales-links-page";

const environment = authoringPageEnvironment("/authoring/sales/links");

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

const meta = {
  ...environment,
  title: "Pages/Authoring/Sales/Payment links",
  component: SalesLinksPage,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "«Ссылки на оплату» (`/authoring/sales/links`): список от новых к старым с фильтром продукта и состояния в адресе, создание в листе на телефоне и в диалоге на компьютере, отзыв из «⋯» с подтверждением. Тот же `PaymentLinksPanel` с `productId` стоит во вкладке «Продажа» продукта.",
      },
    },
  },
} satisfies Meta<typeof SalesLinksPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyDesktop: Story = {
  beforeEach: scenario({ links: [] }),
  globals: desktop.globals,
  name: "Пусто · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("heading", { name: "Ссылок на оплату пока нет" }),
    ).toBeVisible();
    await expect(
      page.getAllByRole("button", { name: "Создать ссылку" }),
    ).toHaveLength(2);
  },
};

export const EmptyMobile: Story = {
  ...EmptyDesktop,
  globals: mobile.globals,
  name: "Пусто · телефон",
};

export const OneLinkDesktop: Story = {
  beforeEach: scenario({ links: storyPaymentLinks(1) }),
  globals: desktop.globals,
  name: "Одна ссылка · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const table = await page.findByRole("table", {
      name: "Ссылки на оплату, новые сверху",
    });
    await expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Продукт", "Состояние", "Цена", "Срок", "Действия"]);
    await expect(within(table).getByText("Готова к оплате")).toBeVisible();
    await expect(within(table).getByText(/25\s415\s₽/u)).toBeVisible();
  },
};

export const OneLinkMobile: Story = {
  beforeEach: scenario({ links: storyPaymentLinks(1) }),
  globals: mobile.globals,
  name: "Одна ссылка · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const list = await page.findByRole("list", {
      name: "Ссылки на оплату, новые сверху",
    });
    await expect(within(list).getByText("AI Engineering")).toBeVisible();
    await expect(
      document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ).toBe(true);
  },
};

export const LongListDesktop: Story = {
  beforeEach: scenario({ links: storyPaymentLinks(45) }),
  globals: desktop.globals,
  name: "Длинный список · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("button", { name: "Показать ещё" }),
    ).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Показать ещё" }));
    await expect(
      page.queryByRole("button", { name: "Показать ещё" }),
    ).not.toBeInTheDocument();
  },
};

export const LongListMobile: Story = {
  beforeEach: scenario({ links: storyPaymentLinks(45) }),
  globals: mobile.globals,
  name: "Длинный список · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("button", { name: "Показать ещё" }),
    ).toBeVisible();
  },
};

export const FilteredByState: Story = {
  beforeEach: scenario({ links: storyPaymentLinks(45) }, "state=revoked"),
  globals: desktop.globals,
  name: "Фильтр по состоянию из адреса",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("button", { name: "Убрать фильтр «Отозвана»" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Сбросить" })).toBeVisible();
  },
};

export const NoResults: Story = {
  beforeEach: scenario({ links: storyPaymentLinks(3) }, "state=changed"),
  globals: mobile.globals,
  name: "Фильтры ничего не нашли · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("heading", { name: "Ничего не найдено" }),
    ).toBeVisible();
  },
};

export const RevokeConfirmation: Story = {
  beforeEach: scenario({ links: storyPaymentLinks(3) }),
  globals: desktop.globals,
  name: "Отзыв · подтверждение",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(
      await page.findByRole("button", {
        name: "Действия со ссылкой «AI Engineering» от 26 окт. 2026",
      }),
    );
    await userEvent.click(
      await within(document.body).findByRole("menuitem", { name: "Отозвать" }),
    );
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Отозвать ссылку на «AI Engineering»?",
    });
    await expect(
      within(dialog).getByRole("button", { name: "Отмена" }),
    ).toHaveFocus();
  },
};

export const Unavailable: Story = {
  beforeEach: scenario({ unavailable: true }),
  globals: desktop.globals,
  name: "Ошибка чтения",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("heading", { name: "Не удалось загрузить ссылки" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  },
};

/** Щелчок по строке открывает подробности ссылки: диалог с копированием и оформлением. */
export const LinkDetailsDesktop: Story = {
  beforeEach: scenario({ links: storyPaymentLinks(3) }),
  globals: desktop.globals,
  name: "Подробности ссылки · диалог",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const table = await page.findByRole("table", {
      name: "Ссылки на оплату, новые сверху",
    });
    await userEvent.click(
      within(table).getAllByRole("button", { name: "AI Engineering" })[0] ??
        table,
    );
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Ссылка на оплату",
    });
    await expect(within(dialog).getByText("Готова к оплате")).toBeVisible();
    await expect(
      within(dialog).getByRole("textbox", { name: "Ссылка для покупателя" }),
    ).toHaveDisplayValue(/\/payment\/links\//u);
    await expect(
      within(dialog).getByRole("button", { name: "Скопировать ссылку" }),
    ).toBeVisible();
    await expect(
      within(dialog).getByRole("link", { name: "Открыть оформление" }),
    ).toBeVisible();
  },
};

/** На телефоне подробности ссылки открываются листом снизу по касанию строки. */
export const LinkDetailsMobile: Story = {
  beforeEach: scenario({ links: storyPaymentLinks(3) }),
  globals: mobile.globals,
  name: "Подробности ссылки · лист",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const list = await page.findByRole("list", {
      name: "Ссылки на оплату, новые сверху",
    });
    const rows = within(list).getAllByRole("listitem");
    await userEvent.click(within(rows[2] ?? list).getByText(/Без срока|^по /u));
    const dialog = await within(document.body).findByRole("dialog", {
      name: "Ссылка на оплату",
    });
    await expect(within(dialog).getByText(/^Создана /u)).toBeVisible();
    await expect(
      document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ).toBe(true);
  },
};

/** Аккаунт без права billing:manage: отказ без повтора, фильтров и «Создать ссылку». */
export const RefusedDesktop: Story = {
  beforeEach: scenario({ forbidden: true }),
  globals: desktop.globals,
  name: "Нет права · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("heading", {
        name: "Нет права на ссылки на оплату",
      }),
    ).toBeVisible();
    await expect(page.queryByRole("button", { name: "Повторить" })).toBeNull();
    await expect(
      page.queryByRole("button", { name: "Создать ссылку" }),
    ).toBeNull();
    await expect(page.queryByRole("combobox")).toBeNull();
  },
};

export const RefusedMobile: Story = {
  ...RefusedDesktop,
  globals: mobile.globals,
  name: "Нет права · телефон",
};

export const Loading: Story = {
  beforeEach: scenario({ held: true }),
  globals: mobile.globals,
  name: "Загрузка · телефон",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(await page.findAllByText("Загружаем ссылки")).not.toHaveLength(
      0,
    );
  },
};
