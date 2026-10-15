import type { Meta, StoryObj } from "@storybook/react-vite";
import { PaymentLinksPrototype } from "./payment-links-prototype";
import { authoringPageEnvironment } from "@/storybook/story-environment";

const meta = {
  ...authoringPageEnvironment("/authoring/billing"),
  title: "Prototypes/Commercial/PaymentLinks",
  component: PaymentLinksPrototype,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Throwaway proof for #1450. Three owner layouts and buyer states. No backend, bank calls or real links. Not production implementation.",
      },
    },
  },
} satisfies Meta<typeof PaymentLinksPrototype>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Owner: Story = {};
export const Buyer: Story = { args: { initialBuyer: true } };
export const Pending: Story = {
  args: { initialBuyer: true, initialState: "pending" },
};
export const Unknown: Story = {
  args: { initialBuyer: true, initialState: "unknown" },
};
export const Paid: Story = {
  args: { initialBuyer: true, initialState: "paid" },
};
export const Revoked: Story = {
  args: { initialBuyer: true, initialState: "revoked" },
};
export const Expired: Story = {
  args: { initialBuyer: true, initialState: "expired" },
};
export const Failed: Story = {
  args: { initialBuyer: true, initialState: "failed" },
};
