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
      await canvas.findByRole("textbox", { name: "Отображаемое имя" }),
    ).toHaveValue("Кирилл Сачков");
    await expect(
      canvas.queryByRole("textbox", { name: /О себе/ }),
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

export const FirstEmailAttachment: Story = {
  ...accountSectionEnvironment("/account", {
    fetch: () => {
      let email: string | null = null;
      return respondByPath({
        ...subscribedMemberRoutes,
        "/api/account/email": () => Response.json({ ok: true, email }),
        "/api/account/email/start": () =>
          Response.json({ ok: true, challengeRef: "synthetic-challenge" }),
        "/api/account/email/confirm": () => {
          email = "new@example.test";
          return Response.json({ ok: true });
        },
      });
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Добавить почту" }),
    );
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Адрес почты" }),
      "new@example.test",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Получить код" }));
    await userEvent.type(
      await canvas.findByRole("textbox", { name: "Код из письма" }),
      "123456",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Подтвердить почту" }),
    );
    await expect(await canvas.findByText("new@example.test")).toBeVisible();
    await expect(
      canvas.getByText(/Почта подтверждена и привязана/),
    ).toBeVisible();
  },
};
