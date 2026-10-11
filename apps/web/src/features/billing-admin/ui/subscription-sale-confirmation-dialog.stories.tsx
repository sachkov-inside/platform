import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { SubscriptionSaleConfirmationDialog } from "./subscription-sale-confirmation-dialog.client";

const meta = {
  title: "Features/Billing/Subscription sale confirmation",
  component: SubscriptionSaleConfirmationDialog,
  args: {
    offerName: "Материалы",
    trigger: null,
    busy: false,
    onCancel: fn(),
    onConfirm: fn(),
  },
} satisfies Meta<typeof SubscriptionSaleConfirmationDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const NarrowMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile320" } },
};
export const Cancel: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = within(canvasElement).getByRole("dialog");
    const cancel = within(dialog).getByRole("button", { name: "Отмена" });
    await expect(cancel).toHaveFocus();
    await userEvent.click(cancel);
    await expect(args.onCancel).toHaveBeenCalledTimes(1);
    await expect(args.onConfirm).not.toHaveBeenCalled();
    await expect(dialog).not.toBeVisible();
  },
};
export const ConfirmOnce: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = within(canvasElement).getByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Включить продажу всем",
    });
    confirm.click();
    confirm.click();
    await expect(args.onConfirm).toHaveBeenCalledTimes(1);
    await expect(args.onCancel).not.toHaveBeenCalled();
    await expect(dialog).not.toBeVisible();
  },
};
export const Busy: Story = {
  args: { busy: true },
  play: async ({ canvasElement, args }) => {
    const dialog = within(canvasElement).getByRole("dialog");
    await expect(
      within(dialog).getByRole("button", { name: "Включить продажу всем" }),
    ).toBeDisabled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Отмена" }),
    );
    await expect(args.onConfirm).not.toHaveBeenCalled();
    await expect(args.onCancel).toHaveBeenCalledTimes(1);
  },
};
