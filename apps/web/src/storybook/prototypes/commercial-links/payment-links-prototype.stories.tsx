import type { Meta, StoryObj } from "@storybook/react-vite";
import { PaymentLinksPrototype } from "./payment-links-prototype";
import {
  authoringPageEnvironment,
  publicPageEnvironment,
} from "@/storybook/story-environment";

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
const buyerEnvironment = publicPageEnvironment("/products/ai-engineering/buy", {
  account: "guest",
});
export const Buyer: Story = {
  ...buyerEnvironment,
  args: { initialBuyer: true },
};
export const Pending: Story = {
  ...buyerEnvironment,
  args: { initialBuyer: true, initialState: "pending" },
};
export const Unknown: Story = {
  ...buyerEnvironment,
  args: { initialBuyer: true, initialState: "unknown" },
};
export const Paid: Story = {
  ...buyerEnvironment,
  args: { initialBuyer: true, initialState: "paid" },
};
export const Revoked: Story = {
  ...buyerEnvironment,
  args: { initialBuyer: true, initialState: "revoked" },
};
export const Expired: Story = {
  ...buyerEnvironment,
  args: { initialBuyer: true, initialState: "expired" },
};
export const Failed: Story = {
  ...buyerEnvironment,
  args: { initialBuyer: true, initialState: "failed" },
};
