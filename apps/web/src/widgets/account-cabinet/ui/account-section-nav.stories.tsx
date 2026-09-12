import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { accountSections, visibleAccountSections } from "../model/account-sections";
import { AccountSectionNav } from "./account-section-nav.client";
import { publicPageEnvironment } from "@/workshop/story-environment";

const environment = publicPageEnvironment("/account");

const meta = {
  ...environment,
  title: "Components/Account/Section navigation",
  component: AccountSectionNav,
  args: { currentHref: "/account", sections: accountSections },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Разделы кабинета: постоянная боковая навигация на десктопе и раскрывающийся список на телефоне. «Подписка» появляется, когда её продают или когда она уже есть.",
      },
    },
    nextjs: { appDirectory: true },
  },
} satisfies Meta<typeof AccountSectionNav>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getAllByRole("link", { name: /Профиль/u })[0],
    ).toHaveAttribute("aria-current", "page");
  },
};

export const WithoutSubscription: Story = {
  args: {
    currentHref: "/account/purchases",
    sections: visibleAccountSections({
      subscriptionOffered: false,
      subscriptionOwned: false,
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("link", { name: /Подписка/u }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getAllByRole("link", { name: /Покупки/u }).length,
    ).toBeGreaterThan(0);
  },
};

export const MobileList: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  args: { currentHref: "/account/notifications" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const disclosure = canvas.getByRole("button", { expanded: false });

    await userEvent.click(disclosure);

    await expect(canvas.getByRole("button", { expanded: true })).toBeVisible();
  },
};
