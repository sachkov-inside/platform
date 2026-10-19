import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

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
      canvas.queryByRole("textbox", { name: "Имя", exact: true }),
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
      canvas.queryByRole("heading", { name: "Подписка", exact: true }),
    ).not.toBeInTheDocument();
  },
};
export const Mobile: Story = {
  ...WithSubscription,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
