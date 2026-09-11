import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import {
  activeSubscription,
  billingOffers,
  canceledSubscription,
  legalDocuments,
  materialsOffer,
  scheduledChangeQuote,
  subscriptionWithPendingChange,
  upgradeChangeQuote,
} from "@/workshop/billing.fixtures";

import { SubscriptionSectionView } from "./subscription-view.client";

const meta = {
  title: "Pages/Account/Subscription",
  component: SubscriptionSectionView,
  args: {
    subscription: activeSubscription,
    options: billingOffers,
    selectedOptionId: null,
    changeQuote: null,
    resumeDocuments: legalDocuments,
    resumeAccepted: [],
    storefrontHref: "/subscription",
    onCancelRenewal: fn(),
    onResumeRenewal: fn(),
    onToggleResumeDocument: fn(),
    onSelectOption: fn(),
    onQuoteChange: fn(),
    onConfirmChange: fn(),
    onCancelPendingChange: fn(),
  },
  parameters: {
    docs: {
      description: {
        component:
          "Раздел «Подписка»: тариф, оплаченный срок, следующее списание и управление продлением. Способ оплаты и история денег принадлежат разделу «Покупки».",
      },
    },
  },
} satisfies Meta<typeof SubscriptionSectionView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Действует")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Отменить продление" }),
    ).toBeEnabled();
    // Способ оплаты — задача раздела «Покупки».
    await expect(canvas.queryByText("Способ оплаты")).not.toBeInTheDocument();
  },
};

export const Canceled: Story = {
  args: { subscription: canceledSubscription },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Списаний больше не будет")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Возобновить списания" }),
    ).toBeDisabled();
  },
};

export const ResumeConsented: Story = {
  args: { subscription: canceledSubscription, resumeAccepted: ["recurring"] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Возобновить списания" }),
    ).toBeEnabled();
  },
};

export const PendingChangeAndUnknownAttempt: Story = {
  args: { subscription: subscriptionWithPendingChange },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/Результат ещё неизвестен/u),
    ).toBeInTheDocument();
  },
};

export const UpgradeQuote: Story = {
  args: {
    selectedOptionId: billingOffers[1]?.paymentOption.id ?? null,
    changeQuote: upgradeChangeQuote,
  },
};

export const ScheduledChangeQuote: Story = {
  args: {
    selectedOptionId: billingOffers[0]?.paymentOption.id ?? null,
    changeQuote: scheduledChangeQuote,
  },
};

export const NoSubscription: Story = {
  args: { subscription: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Действующей подписки нет"),
    ).toBeInTheDocument();
  },
};

export const MaterialsWithoutTelegram: Story = {
  args: {
    subscription: {
      ...activeSubscription,
      snapshot: {
        offer: materialsOffer.offer,
        paymentOption: materialsOffer.paymentOption,
        currency: "RUB",
        timezone: "Europe/Moscow",
        renewalPriceKopecks: materialsOffer.renewalPriceKopecks,
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getAllByText("Все опубликованные материалы и руководства").length,
    ).toBeGreaterThan(0);
    await expect(canvas.queryByText("Общий чат")).not.toBeInTheDocument();
  },
};

export const SessionExpired: Story = { args: { sessionExpired: true } };
export const Loading: Story = { args: { subscription: null, loading: true } };
export const Unavailable: Story = {
  args: { error: "Данные оплаты сейчас недоступны. Повторите позже." },
};
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
