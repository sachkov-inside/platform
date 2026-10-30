import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { ProductSalePanel } from "@/features/product-sale-settings";
import { factAnnouncement } from "@/shared/api/fact-announcement";
import { getQueryClient } from "@/shared/api/query-client";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import {
  betweenState,
  preorderState,
  productSaleBff,
  runningPrice,
  runningState,
  saleProductId,
  saleProductName,
  type SaleBffOptions,
} from "@/storybook/product-sale.fixtures";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { ProductEditorPageFrame } from "./product-editor-page-frame";

/** Вкладка «Продажа» стоит в рамке страницы продукта: так её рендерит маршрут. */
const environment = authoringPageEnvironment(
  `/authoring/products/${saleProductId}?tab=sale`,
  { frame: ProductEditorPageFrame },
);

function replies(options: SaleBffOptions) {
  return () => {
    getQueryClient().clear();
    return fetchBeforeRender(productSaleBff(options))();
  };
}

/** Сколько объявлений о записи услышали каналы фактов продажи за время проверки. */
function listenToSaleFacts() {
  const names = [
    "inside.owner.price-catalog.changed",
    "inside.owner.product-sale.changed",
  ] as const;
  const heard: Record<string, number> = {};
  const unsubscribe = names.map((name) => {
    heard[name] = 0;
    return factAnnouncement(name).subscribe(() => {
      heard[name] = (heard[name] ?? 0) + 1;
    });
  });
  return {
    heard: () => ({ ...heard }),
    close: () => {
      for (const stop of unsubscribe) stop();
    },
  };
}

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const meta = {
  ...environment,
  args: {
    archived: false,
    productId: saleProductId,
    productName: saleProductName,
  },
  beforeEach: [
    environment.beforeEach,
    replies({ price: runningPrice, salesState: runningState }),
  ],
  component: ProductSalePanel,
  id: "features-product-продажа-продукта",
  title: "Patterns/Authoring/Product sale tab",
} satisfies Meta<typeof ProductSalePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Продукт без цены: продавать нечего, цена сохранится без открытия продаж. */
export const UnpricedDesktop: Story = {
  ...desktop,
  beforeEach: [environment.beforeEach, replies({})],
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText("Нет цены", { selector: ".admin-badge" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Открыть продажи" }),
    ).toBeDisabled();
    await expect(
      page.queryByRole("button", { name: /^Действия с ценой/u }),
    ).toBeNull();
    await userEvent.type(
      page.getByRole("textbox", { name: "Цена, ₽" }),
      "9 900",
    );
    const facts = listenToSaleFacts();
    await userEvent.click(page.getByRole("button", { name: "Сохранить цену" }));
    await expect(await page.findByText("Цена сохранена.")).toBeVisible();
    // Запись цены объявлена: другие вкладки и поверхности перечитают каталог цен и продажу.
    await waitFor(async () => {
      await expect(facts.heard()).toEqual({
        "inside.owner.price-catalog.changed": 1,
        "inside.owner.product-sale.changed": 1,
      });
    });
    facts.close();
    await expect(
      await page.findByText("Продажи закрыты", { selector: ".admin-badge" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Открыть продажи" }),
    ).toBeEnabled();
  },
};
export const UnpricedMobile: Story = { ...UnpricedDesktop, ...mobile };

/** Цена есть, продажи закрыты: оплата не принимается, полученный доступ сохраняется. */
export const ClosedDesktop: Story = {
  ...desktop,
  beforeEach: [
    environment.beforeEach,
    replies({
      price: { ...runningPrice, published: false },
      salesState: preorderState,
    }),
  ],
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText("Продажи закрыты", { selector: ".admin-badge" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Цена, ₽" }),
    ).toHaveDisplayValue(/^49\s900$/u);
    await expect(
      page.getByRole("radio", { name: "Предзаказ до старта" }),
    ).toBeChecked();
  },
};
export const ClosedMobile: Story = { ...ClosedDesktop, ...mobile };

/** Идёт поток, продажи открыты. Закрытие спрашивает подтверждение и не отзывает доступ. */
export const RunningDesktop: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText("Поток идёт", { selector: ".admin-badge" }),
    ).toBeVisible();
    await userEvent.click(
      page.getByRole("button", { name: "Закрыть продажи" }),
    );
    const dialog = await within(canvasElement.ownerDocument.body).findByRole(
      "dialog",
      { name: "Закрыть продажи?" },
    );
    await expect(dialog).toHaveTextContent(
      "Закрытие не отзывает полученный доступ",
    );
    await expect(
      within(dialog).getByRole("button", { name: "Отмена" }),
    ).toHaveFocus();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Закрыть продажи" }),
    );
    await expect(await page.findByText("Продажи закрыты.")).toBeVisible();
    await expect(
      await page.findByRole("button", { name: "Открыть продажи" }),
    ).toBeVisible();
  },
};
export const RunningMobile: Story = { ...RunningDesktop, ...mobile };

/** Между потоками: даты старта нет, вместо неё событие следующего потока. */
export const BetweenDesktop: Story = {
  ...desktop,
  beforeEach: [
    environment.beforeEach,
    replies({ price: runningPrice, salesState: betweenState }),
  ],
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText("Между потоками", { selector: ".admin-badge" }),
    ).toBeVisible();
    const event = page.getByRole("textbox", {
      name: "Событие следующего потока",
    });
    await expect(event).toHaveValue(betweenState.nextEvent);
    await userEvent.clear(event);
    await userEvent.click(
      page.getByRole("button", { name: "Сохранить состояние продажи" }),
    );
    await expect(
      await page.findByText("Между потоками нужно событие следующего потока"),
    ).toBeVisible();
  },
};
export const BetweenMobile: Story = { ...BetweenDesktop, ...mobile };

/**
 * Цену изменили в другой вкладке: запись получает конфликт ревизии. Панель предлагает обновить
 * данные и сама команду не повторяет.
 */
export const ConflictDesktop: Story = {
  ...desktop,
  beforeEach: [
    environment.beforeEach,
    replies({
      price: runningPrice,
      salesState: runningState,
      conflictOnce: true,
    }),
  ],
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const amount = await page.findByRole("textbox", { name: "Цена, ₽" });
    await userEvent.clear(amount);
    await userEvent.type(amount, "39 900");
    await userEvent.click(page.getByRole("button", { name: "Сохранить цену" }));
    const alert = await page.findByRole("alert");
    await expect(alert).toHaveTextContent("изменились в другом месте");
    await expect(
      page.getByRole("button", { name: "Сохранить цену" }),
    ).toBeDisabled();
    await userEvent.click(
      within(alert).getByRole("button", { name: "Обновить данные" }),
    );
    await waitFor(() => expect(page.queryByRole("alert")).toBeNull());
    await expect(
      page.getByRole("textbox", { name: "Цена, ₽" }),
    ).toHaveDisplayValue(/^49\s900$/u);
  },
};
export const ConflictMobile: Story = { ...ConflictDesktop, ...mobile };

/** Архив цены живёт в «⋯», спрашивает подтверждение и оставляет вкладку в состоянии архива. */
export const ArchivePriceDesktop: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(
      await page.findByRole("button", {
        name: `Действия с ценой «${saleProductName}»`,
      }),
    );
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      await body.findByRole("menuitem", { name: "Архивировать цену" }),
    );
    const dialog = await body.findByRole("dialog", {
      name: "Архивировать цену?",
    });
    await expect(dialog).toHaveTextContent("Полученный доступ");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Архивировать цену" }),
    );
    await expect(
      await page.findByText("Цена в архиве", { selector: ".admin-badge" }),
    ).toBeVisible();
  },
};
export const ArchivePriceMobile: Story = {
  ...ArchivePriceDesktop,
  ...mobile,
};

/**
 * Цена в архиве: billing её не возвращает и новую не принимает, поэтому формы цены нет, а продажи
 * не открыть. Состояние продажи остаётся редактируемым.
 */
export const PriceArchivedDesktop: Story = {
  ...desktop,
  beforeEach: [
    environment.beforeEach,
    replies({ priceArchived: true, salesState: runningState }),
  ],
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText("Цена в архиве", { selector: ".admin-badge" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Вернуть её или задать новую нельзя/u),
    ).toBeVisible();
    await expect(page.queryByRole("textbox", { name: "Цена, ₽" })).toBeNull();
    await expect(
      page.queryByRole("button", { name: /^Действия с ценой/u }),
    ).toBeNull();
    await expect(
      page.getByRole("button", { name: "Открыть продажи" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Сохранить состояние продажи" }),
    ).toBeEnabled();
  },
};
export const PriceArchivedMobile: Story = {
  ...PriceArchivedDesktop,
  ...mobile,
};

/** Продукт в архиве: продажи закрыты, открыть их нельзя. */
export const ArchivedProductDesktop: Story = {
  ...desktop,
  args: { archived: true },
  beforeEach: [
    environment.beforeEach,
    replies({
      price: { ...runningPrice, published: false },
      salesState: runningState,
    }),
  ],
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText("Продукт в архиве", { selector: ".admin-badge" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Открыть продажи" }),
    ).toBeDisabled();
  },
};
export const ArchivedProductMobile: Story = {
  ...ArchivedProductDesktop,
  ...mobile,
};

export const LoadingDesktop: Story = {
  ...desktop,
  beforeEach: [environment.beforeEach, replies({ pending: true })],
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("status"),
    ).toHaveTextContent("Загружаем продажу");
  },
};
export const LoadingMobile: Story = { ...LoadingDesktop, ...mobile };

export const UnavailableDesktop: Story = {
  ...desktop,
  beforeEach: [environment.beforeEach, replies({ readFailure: "unavailable" })],
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("heading", {
        name: "Не удалось прочитать продажу",
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  },
};
export const UnavailableMobile: Story = { ...UnavailableDesktop, ...mobile };

export const ForbiddenDesktop: Story = {
  ...desktop,
  beforeEach: [environment.beforeEach, replies({ readFailure: "forbidden" })],
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("heading", { name: "Нет доступа к продажам" }),
    ).toBeVisible();
    await expect(page.queryByRole("button")).toBeNull();
  },
};
export const ForbiddenMobile: Story = { ...ForbiddenDesktop, ...mobile };
