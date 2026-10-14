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
export const Community: Story = {
  args: { initialState: "telegram", includesCommunity: true },
};
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
      canvas.queryByRole("textbox", { name: "Email" }),
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
      canvas.getByRole("textbox", { name: "Email" }),
      "reader@example.com",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Оплатить 100 ₽" }),
    );
    await expect(canvas.getByText("Готовим страницу банка")).toBeVisible();
  },
};

export const CommunityJourney: Story = {
  args: { includesCommunity: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("region", { name: "Сообщество продукта" }),
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
    await userEvent.click(
      canvas.getByRole("button", { name: "Демо: Доступ подготовлен" }),
    );
    await expect(
      canvas.queryByRole("button", { name: "Привязать Telegram" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole("button", {
        name: /Открыть «Создание Platform Inside»/u,
      }),
    );
    await expect(
      canvas.getByRole("region", { name: "Программа продукта" }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Привязать Telegram" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Вступить в группу продукта" }),
    );
    await expect(
      canvas.getByText("Заявка на вступление отправлена. Ждём подтверждения."),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Демо: Бот подтвердил вступление" }),
    );
    await expect(
      canvas.queryByRole("region", { name: "Сообщество продукта" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("region", { name: "Программа продукта" }),
    ).toBeVisible();
  },
};

export const PurchaseIdentity: Story = {
  args: { initialState: "purchases" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Продолжить оформление" }),
    );
    await expect(canvas.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Инженерная практика",
    );
    await expect(
      canvas.getByText("Оплата подтверждена. Открываем доступ"),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByText("Покупка и чек", { selector: "summary" }),
    );
    await expect(canvas.getByText(/Покупка № DEMO-1444/u)).toBeVisible();
    await expect(canvas.queryByText(/DEMO-1442/u)).not.toBeInTheDocument();
  },
};

export const RefundAccess: Story = {
  args: { initialState: "otherGrant" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Открыть продукт" }),
    );
    await expect(
      canvas.getByRole("region", { name: "Программа продукта" }),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Мои покупки" }));
    await expect(canvas.getByText(/Возвращено полностью/u)).toBeVisible();
    await expect(
      canvas.getByText(/Доступ открыт по ручному назначению/u),
    ).toBeVisible();
    await expect(
      canvas.queryByText("Оплата подтверждена. Можно начать обучение."),
    ).not.toBeInTheDocument();
  },
};

export const WithoutDiscount: Story = {
  args: { discounted: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("Скидка 50%")).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Оплатить 100 ₽" }),
    ).toBeVisible();
  },
};

export const ProgrammeWithoutCommunity: Story = {
  args: { initialState: "ready", initialProductOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("region", { name: "Программа продукта" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("region", { name: "Сообщество продукта" }),
    ).not.toBeInTheDocument();
  },
};

export const AlreadyJoined: Story = {
  args: { initialState: "member", includesCommunity: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("region", { name: "Программа продукта" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("region", { name: "Сообщество продукта" }),
    ).not.toBeInTheDocument();
  },
};
