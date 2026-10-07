import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import { billingErrorMessage } from "@/entities/subscription";
import { pendingPurchase, unknownPurchase } from "@/storybook/billing.fixtures";

import { PurchaseReturnView } from "./purchase-return.client";
import { publicPageEnvironment } from "@/storybook/story-environment";

const environment = publicPageEnvironment("/payment/return");

const meta = {
  ...environment,
  title: "Components/Billing/Purchase return",
  component: PurchaseReturnView,
  args: {
    purchase: null,
    accountHref: "/account/subscription",
    onRefresh: fn(),
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Возврат из банка ничего не подтверждает: страница показывает состояние, сохранённое сервером. Здесь — состояния до открытия доступа; подтверждённая оплата со слотом сообщества показана в «Pages/Subscription/Return».",
      },
    },
  },
} satisfies Meta<typeof PurchaseReturnView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Checking: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/Переход обратно не подтверждает оплату/u),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Проверяем состояние оплаты…",
    );
  },
};
export const AwaitingBank: Story = {
  args: { purchase: pendingPurchase },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Ждёт подтверждения оплаты"),
    ).toBeInTheDocument();
  },
};
export const Unknown: Story = { args: { purchase: unknownPurchase } };
export const UnknownReference: Story = {
  args: { unknownReference: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(
        "Не нашли начатую оплату в этом браузере.",
      ),
    ).toBeInTheDocument();
  },
};
export const Unavailable: Story = {
  args: { error: billingErrorMessage("unavailable") },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("alert")).toHaveTextContent(
      billingErrorMessage("unavailable"),
    );
  },
};
