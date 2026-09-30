import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import { PurchaseReturnView } from "@/features/billing-checkout";
import { CommunityEntryView } from "@/features/community-entry";
import { confirmedPurchase, failedPurchase } from "@/workshop/billing.fixtures";
import { publicPageEnvironment } from "@/workshop/story-environment";

const environment = publicPageEnvironment("/subscription/return");
const botUrl = "https://t.me/inside_storybook_bot";

const meta = {
  ...environment,
  title: "Pages/Subscription/Return/Community",
  component: PurchaseReturnView,
  args: {
    purchase: confirmedPurchase,
    accountHref: "/account/subscription",
    accessSlot: (
      <CommunityEntryView
        entry={{ kind: "join", botUrl }}
        onRetry={fn()}
        telegramHref="/account/access"
      />
    ),
    onRefresh: fn(),
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "После оплаты курса с сообществом покупатель сразу видит, как попасть в группу Inside. Пока доступ не открыт, перехода нет.",
      },
    },
  },
} satisfies Meta<typeof PurchaseReturnView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ConfirmedJoin: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: "Вступить в сообщество" }),
    ).toHaveAttribute("href", botUrl);
  },
};
export const ConfirmedMember: Story = {
  args: {
    accessSlot: (
      <CommunityEntryView
        entry={{ kind: "member" }}
        onRetry={fn()}
        telegramHref="/account/access"
      />
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/Вы уже в сообществе Inside/u),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("link", { name: "Вступить в сообщество" }),
    ).toBeNull();
  },
};
export const FailedHidesCommunity: Story = {
  args: { purchase: failedPurchase },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("Сообщество Inside")).toBeNull();
  },
};
export const ConfirmedJoinMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const ConfirmedJoinDesktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
