import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { individualSnapshot } from "@/storybook/payment-links.fixtures";
import { PaymentLinkSummary } from "./payment-link-summary";
const meta = {
  title: "Components/Billing/Payment link summary",
  component: PaymentLinkSummary,
  args: { snapshot: individualSnapshot, title: "AI Engineering" },
} satisfies Meta<typeof PaymentLinkSummary>;
export default meta;
type Story = StoryObj<typeof meta>;
export const PriceAndTerms: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText(/26\s?100\s?₽/u),
    ).toBeVisible();
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Все условия покупки"));
    await expect(
      canvas.getByText(/Сопровождение автора по условиям оферты/u),
    ).toBeVisible();
    await expect(
      canvas.queryByText(/Сопровождение автора[^.]*3 месяца/u),
    ).not.toBeInTheDocument();
  },
};
