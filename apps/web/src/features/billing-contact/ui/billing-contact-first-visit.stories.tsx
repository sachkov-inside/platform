import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { accountSectionEnvironment } from "@/storybook/story-environment";

import { BillingContactForm } from "./billing-contact-form.client";

const environment = accountSectionEnvironment("/account/purchases", {
  storageNotice: "first-visit",
});

const meta = {
  ...environment,
  title: "Components/Account/Billing contact first visit",
  component: BillingContactForm,
  args: {
    contact: null,
    challenge: { email: "buyer@example.test", delivery: "sent" },
    onConfirm: fn(),
    onStart: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("region", { name: "Хранение в браузере" }),
    ).toBeInTheDocument();
    await userEvent.type(canvas.getByLabelText("Код из письма"), "123456");
    const confirm = canvas.getByRole("button", { name: "Подтвердить email" });
    confirm.scrollIntoView({ block: "nearest" });
    await userEvent.click(confirm);
    await expect(args.onConfirm).toHaveBeenCalledWith("123456");
  },
} satisfies Meta<typeof BillingContactForm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
