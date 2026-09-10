import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import {
  activeSubscription,
  materialsOffer,
  billingNotices,
  billingOffers,
  canceledSubscription,
  legalDocuments,
  scheduledChangeQuote,
  subscriptionWithPendingChange,
  upgradeChangeQuote,
} from "@/workshop/billing.fixtures";

import { BillingCabinetView } from "./billing-cabinet-view.client";

const meta = {
  title: "Pages/Account/Billing cabinet",
  component: BillingCabinetView,
  args: {
    subscription: activeSubscription,
    notices: billingNotices,
    options: billingOffers,
    selectedOptionId: null,
    changeQuote: null,
    resumeDocuments: legalDocuments,
    resumeAccepted: [],
    storefrontHref: "/subscription",
    contactHref: "/account/email",
    onRefresh: fn(),
    onCancelRenewal: fn(),
    onResumeRenewal: fn(),
    onToggleResumeDocument: fn(),
    onSelectOption: fn(),
    onQuoteChange: fn(),
    onConfirmChange: fn(),
    onCancelPendingChange: fn(),
    onChangeMethod: fn(),
    onRevokeMethod: fn(),
  },
  parameters: {
    docs: {
      description: {
        component:
          "Кабинет объясняет, что уже доступно, по какому основанию и до какого срока. Состояния оплаты и выдачи прав различаются.",
      },
    },
  },
} satisfies Meta<typeof BillingCabinetView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Действует")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Отменить продление" }),
    ).toBeEnabled();
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
  args: { subscription: null, notices: [] },
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
      canvas.getByText("Все опубликованные материалы и руководства"),
    ).toBeInTheDocument();
    await expect(canvas.queryByText("Общий чат")).not.toBeInTheDocument();
  },
};
export const SessionExpired: Story = { args: { sessionExpired: true } };
export const Loading: Story = { args: { subscription: null, loading: true } };
export const Unavailable: Story = {
  args: {
    error: "Данные оплаты сейчас недоступны. Повторите позже.",
  },
};
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
