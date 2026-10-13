import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CheckoutEmailField } from "./checkout-email-field.client";

const meta = {
  title: "Components/Billing/Checkout Email",
  component: CheckoutEmailField,
  args: { value: "", onChange: fn() },
  render: function Render(args) {
    const [value, setValue] = useState(args.value);
    return (
      <CheckoutEmailField
        {...args}
        value={value}
        onChange={(next) => {
          setValue(next);
          args.onChange(next);
        }}
      />
    );
  },
} satisfies Meta<typeof CheckoutEmailField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Editable: Story = {
  play: async ({ canvasElement, args }) => {
    const email = within(canvasElement).getByRole("textbox", {
      name: "Email для чека",
    });
    await userEvent.type(email, "buyer@example.test");
    await expect(email).toHaveValue("buyer@example.test");
    await expect(args.onChange).toHaveBeenLastCalledWith("buyer@example.test");
  },
};
export const Invalid: Story = {
  args: {
    value: "broken",
    error: "Проверьте email: например, name@example.com.",
  },
};
export const Sending: Story = {
  args: { value: "buyer@example.test", disabled: true },
};
