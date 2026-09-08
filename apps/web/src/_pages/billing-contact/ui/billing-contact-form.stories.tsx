import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { BillingContactForm } from "./billing-contact-form.client";
const meta = {
  title: "Pages/Account/Billing contact",
  component: BillingContactForm,
  args: {
    contact: null,
    challenge: null,
    onStart: fn(),
    onConfirm: fn(),
    onRefresh: fn(),
  },
  parameters: {
    docs: {
      description: {
        component:
          "Функциональная форма #406. Финальная визуальная интеграция и согласия в checkout — #411.",
      },
    },
  },
} satisfies Meta<typeof BillingContactForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByLabelText("Email", { exact: true }),
      "buyer@example.test",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Получить код" }));
    await expect(args.onStart).toHaveBeenCalledWith("buyer@example.test");
    await expect(canvas.queryByRole("checkbox")).not.toBeInTheDocument();
  },
};
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Loading: Story = { args: { loading: true } };
export const Verified: Story = {
  args: {
    verified: true,
    contact: {
      email: "buyer@example.test",
      revision: 1,
      verifiedAt: "2026-09-08T12:00:00.000Z",
    },
  },
};
export const Code: Story = {
  args: { challenge: { email: "buyer@example.test", delivery: "sent" } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Код из письма"), "123456");
    await userEvent.click(
      canvas.getByRole("button", { name: "Подтвердить email" }),
    );
    await expect(args.onConfirm).toHaveBeenCalledWith("123456");
  },
};
export const UnknownDelivery: Story = {
  args: { challenge: { email: "buyer@example.test", delivery: "unknown" } },
};
export const RateLimited: Story = {
  args: {
    error: "Слишком много запросов. Подождите перед отправкой нового кода.",
  },
};
export const Pending: Story = {
  args: {
    pending: true,
    challenge: { email: "buyer@example.test", delivery: "sent" },
  },
};
