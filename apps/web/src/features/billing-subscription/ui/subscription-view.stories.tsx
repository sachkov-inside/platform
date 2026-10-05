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
} from "@/storybook/billing.fixtures";

import { SubscriptionSectionView } from "./subscription-view.client";
import { accountSectionEnvironment } from "@/storybook/story-environment";

const environment = accountSectionEnvironment("/account/subscription");

const meta = {
  ...environment,
  title: "Components/Account/Subscription view",
  component: SubscriptionSectionView,
  args: {
    subscription: activeSubscription,
    options: billingOffers,
    selectedOptionId: null,
    changeQuote: null,
    resumeDocuments: legalDocuments,
    onCancelRenewal: fn(),
    onResumeRenewal: fn(),
    onSelectOption: fn(),
    onQuoteChange: fn(),
    onConfirmChange: fn(),
    onCancelPendingChange: fn(),
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Вид раздела «Подписка» без назначенных тарифов и документов: состояния подписки и расчёты смены тарифа. Раздел целиком, его загрузку, отсутствие подписки, ошибки и отмену продления показывает «Pages/Account/Subscription».",
      },
    },
  },
} satisfies Meta<typeof SubscriptionSectionView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Canceled: Story = {
  args: { subscription: canceledSubscription },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Списаний больше не будет"),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("checkbox")).not.toBeInTheDocument();
    await expect(
      canvas.getByText(
        /следующее списание .+, затем раз в .+\. Отключить продление можно здесь же\./u,
      ),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Возобновить автопродление" }),
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
      canvas.getAllByText("Все опубликованные материалы и продукты").length,
    ).toBeGreaterThan(0);
    await expect(canvas.queryByText("Общий чат")).not.toBeInTheDocument();
  },
};
