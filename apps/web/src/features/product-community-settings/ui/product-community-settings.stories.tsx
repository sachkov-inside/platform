import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ProductCommunitySettings } from "./product-community-settings.client";
const productId = "22222222-2222-4222-8222-222222222222";
const meta = {
  title: "Features/ProductCommunitySettings",
  component: ProductCommunitySettings,
  args: { productId },
  parameters: { layout: "padded" },
} satisfies Meta<typeof ProductCommunitySettings>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FixedProductCommunity: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("Все продукты используют общую группу Telegram."),
    ).toBeVisible();
    await expect(canvas.queryByRole("button")).not.toBeInTheDocument();
  },
};
