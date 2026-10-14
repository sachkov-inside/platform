import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { accountPresentationResponse, respondByPath } from "./account.fixtures";
import { currentBillingResponse } from "./billing.fixtures";
import { fetchBeforeRender } from "./mutation-mock";
import { publicPageEnvironment } from "./story-environment";
import { BuyerJourneyPrototype } from "./buyer-journey-prototype.client";

const environment = publicPageEnvironment("/products/platform-inside/buy", {
  account: "authenticated",
});

const meta = {
  title: "Prototypes/Buyer journey",
  component: BuyerJourneyPrototype,
  ...environment,
  beforeEach: () => {
    environment.beforeEach();
    return fetchBeforeRender(
      respondByPath({
        "/api/account": () => accountPresentationResponse(),
        "/api/account/billing": () => currentBillingResponse(null),
      }),
    )();
  },
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true },
    docs: {
      description: {
        component:
          "Throwaway proof for #1442–1444. All values are illustrative. No payment or Telegram mutations.",
      },
    },
  },
} satisfies Meta<typeof BuyerJourneyPrototype>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Checkout: Story = {};
export const Guest: Story = {
  args: { initialState: "guest" },
  parameters: { account: "guest" },
};
export const Loading: Story = { args: { initialState: "loading" } };
export const MissingEmail: Story = { args: { initialState: "email" } };
export const InvalidEmail: Story = { args: { initialState: "invalid" } };
export const PaymentReturn: Story = { args: { initialState: "waiting" } };
export const AccessPreparing: Story = { args: { initialState: "preparing" } };
export const ReadyWithoutCommunity: Story = { args: { initialState: "ready" } };
export const Community: Story = { args: { initialState: "telegram" } };
export const Purchases: Story = { args: { initialState: "purchases" } };
export const RefundWithOtherGrant: Story = {
  args: { initialState: "otherGrant" },
};
export const CheckoutMobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const CommunityMobile: Story = {
  ...Community,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const ContinuousJourney: Story = {
  args: { initialState: "guest" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Войти и продолжить" }),
    );
    await expect(
      canvas.queryByRole("textbox", { name: "Email для чека" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole("button", { name: "Оплатить 100 ₽" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Демо: Платёж сформирован" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Открыть страницу оплаты" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Демо: Банк подтвердил оплату" }),
    );
    await expect(
      canvas.getByText("Оплата подтверждена. Открываем доступ"),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Демо: Доступ подготовлен" }),
    );
    await expect(
      canvas.getByRole("button", {
        name: /Открыть «Создание Platform Inside»/u,
      }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("region", { name: "Сообщество продукта" }),
    ).not.toBeInTheDocument();
  },
};

export const EmailValidation: Story = {
  args: { initialState: "email" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Оплатить 100 ₽" }),
    );
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Укажите корректный email",
    );
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Email для чека" }),
      "reader@example.com",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Оплатить 100 ₽" }),
    );
    await expect(canvas.getByText("Готовим страницу банка")).toBeVisible();
  },
};
