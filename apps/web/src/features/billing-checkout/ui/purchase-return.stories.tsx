import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import {
  confirmedPurchase,
  failedPurchase,
  unknownPurchase,
} from "@/workshop/billing.fixtures";

import { PurchaseReturnView } from "./purchase-return.client";

const meta = {
  title: "Pages/Subscription/Return",
  component: PurchaseReturnView,
  args: {
    purchase: null,
    accountHref: "/account/subscription",
    onRefresh: fn(),
  },
  parameters: {
    docs: {
      description: {
        component:
          "Возврат из банка ничего не подтверждает: страница показывает состояние, сохранённое сервером.",
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
  },
};
export const Confirmed: Story = { args: { purchase: confirmedPurchase } };
export const Failed: Story = { args: { purchase: failedPurchase } };
export const Unknown: Story = { args: { purchase: unknownPurchase } };
export const UnknownReference: Story = { args: { unknownReference: true } };
export const Mobile: Story = {
  args: { purchase: confirmedPurchase },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  args: { purchase: confirmedPurchase },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
