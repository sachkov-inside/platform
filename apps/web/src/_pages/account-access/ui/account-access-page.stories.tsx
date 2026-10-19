import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { accountSectionEnvironment } from "@/storybook/story-environment";
import {
  respondByPath,
  subscribedMemberRoutes,
} from "@/storybook/account.fixtures";
import {
  currentBillingResponse,
  enrollmentsResponse,
} from "@/storybook/billing.fixtures";
import { AccountAccessPage } from "./account-access-page.client";

const environment = accountSectionEnvironment("/account", {
  fetch: () => respondByPath(subscribedMemberRoutes),
});
const meta = {
  component: AccountAccessPage,
  title: "Pages/Account/Live cabinet",
  args: { policies: [] },
} satisfies Meta<typeof AccountAccessPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithSubscription: Story = {
  ...environment,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("heading", { name: "Личный кабинет" }),
    ).toBeVisible();
    await expect(
      await canvas.findByRole("button", { name: "Отменить продление" }),
    ).toBeEnabled();
    await expect(
      canvas.queryByRole("textbox", { name: "Имя" }),
    ).not.toBeInTheDocument();
  },
};
export const WithoutPurchases: Story = {
  ...accountSectionEnvironment("/account", {
    fetch: () =>
      respondByPath({
        ...subscribedMemberRoutes,
        "/api/account/billing": () => currentBillingResponse(null),
        "/api/account/billing/enrollments": () => enrollmentsResponse([]),
      }),
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Telegram подключён")).toBeVisible();
    await expect(
      canvas.queryByRole("heading", { name: "Подписка" }),
    ).not.toBeInTheDocument();
  },
};
export const Mobile: Story = {
  ...WithSubscription,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const PaymentFailureSurvivesCollapse: Story = {
  ...accountSectionEnvironment("/account", {
    fetch: () =>
      respondByPath({
        ...subscribedMemberRoutes,
        "/api/account/billing/payment-method/revoke": () =>
          Response.json({
            ok: false,
            code: "provider_unavailable",
          }),
      }),
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const purchases = await canvas.findByRole("button", {
      name: /Покупки и оплаты/,
    });
    await userEvent.click(purchases);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Запретить использование" }),
    );
    const error = await canvas.findByText(
      "Банк сейчас не отвечает. Повторите позже — повторный запрос безопасен.",
    );
    await expect(error).toBeVisible();
    await userEvent.click(purchases);
    await expect(error).not.toBeVisible();
    await userEvent.click(purchases);
    await expect(error).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: /История оплат, чеки и возвраты/ }),
    ).toBeVisible();
  },
};
