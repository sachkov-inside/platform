import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { getQueryClient } from "@/shared/api/query-client";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import {
  activationRules,
  productSaleBff,
  saleProductId,
  saleProductName,
  type SaleBffOptions,
} from "@/storybook/product-sale.fixtures";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { ProductCommunityTab } from "./product-community-tab";
import { ProductEditorPageFrame } from "./product-editor-page-frame";

/** Вкладка «Сообщество и активация» в рамке страницы продукта, как на маршруте. */
const environment = authoringPageEnvironment(
  `/authoring/products/${saleProductId}?tab=community`,
  { frame: ProductEditorPageFrame },
);

function replies(options: SaleBffOptions) {
  return () => {
    getQueryClient().clear();
    return fetchBeforeRender(productSaleBff(options))();
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
  args: { productId: saleProductId, productName: saleProductName },
  beforeEach: [environment.beforeEach, replies({ rules: activationRules })],
  component: ProductCommunityTab,
  title: "Features/Product/Сообщество и активация",
} satisfies Meta<typeof ProductCommunityTab>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Общая группа и правила этого продукта; правило другого продукта не показывается. */
export const RulesDesktop: Story = {
  ...desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByText("Все продукты используют общую группу Telegram."),
    ).toBeVisible();
    const list = await page.findByRole("list", {
      name: "Правила активации продукта",
    });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    await expect(list).not.toHaveTextContent("Правило другого продукта");
    await expect(page.queryByRole("textbox", { name: /продукт/iu })).toBeNull();
  },
};
export const RulesMobile: Story = { ...RulesDesktop, ...mobile };

export const EmptyDesktop: Story = {
  ...desktop,
  beforeEach: [environment.beforeEach, replies({ rules: [] })],
  play: async ({ canvasElement }) => {
    await expect(
      await routeContent(canvasElement).findByText(
        "У продукта пока нет правил активации.",
      ),
    ).toBeVisible();
  },
};
export const EmptyMobile: Story = { ...EmptyDesktop, ...mobile };

/** Новое правило берёт продукт со страницы; форма проверяет поля до отправки. */
export const CreateRuleDesktop: Story = {
  ...desktop,
  beforeEach: [environment.beforeEach, replies({ rules: [] })],
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await page.findByText("У продукта пока нет правил активации.");
    await userEvent.click(
      page.getByRole("button", { name: "Создать правило" }),
    );
    await expect(page.getByText("Назовите правило")).toBeVisible();
    await userEvent.type(
      page.getByRole("textbox", { name: "Название правила" }),
      "Осенний поток прежнего курса",
    );
    await userEvent.type(
      page.getByRole("textbox", { name: "Код активации" }),
      "AIENG-AUTUMN",
    );
    await userEvent.type(
      page.getByRole("textbox", { name: "Источник курса" }),
      "inside-course:ai-engineering-autumn-2025",
    );
    await userEvent.type(
      page.getByRole("textbox", { name: "Причина" }),
      "Перенос участников осеннего потока",
    );
    await userEvent.click(
      page.getByRole("button", { name: "Создать правило" }),
    );
    await expect(await page.findByText("Правило создано.")).toBeVisible();
    await expect(
      await page.findByText("Осенний поток прежнего курса"),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Название правила" }),
    ).toHaveValue("");
  },
};
export const CreateRuleMobile: Story = { ...CreateRuleDesktop, ...mobile };

export const UnavailableDesktop: Story = {
  ...desktop,
  beforeEach: [
    environment.beforeEach,
    () => {
      getQueryClient().clear();
      return fetchBeforeRender(() =>
        Promise.resolve(Response.json({ ok: false, code: "unavailable" })),
      )();
    },
  ],
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText(
        "Правила активации сейчас недоступны. Повторите позже.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  },
};
export const UnavailableMobile: Story = { ...UnavailableDesktop, ...mobile };
