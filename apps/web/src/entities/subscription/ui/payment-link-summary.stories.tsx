import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
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
    await expect(
      canvas.getByRole("link", { name: "Все условия покупки в оферте" }),
    ).toHaveAttribute("href", "/legal/purchase");
    await expect(canvas.queryByText(/Сопровождение/u)).not.toBeInTheDocument();
  },
};
