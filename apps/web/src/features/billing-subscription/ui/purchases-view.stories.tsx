import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import {
  accessGrounds,
  activeSubscription,
  billingNotices,
  ownPayments,
} from "@/workshop/billing.fixtures";

import { PurchasesSectionView } from "./purchases-view.client";

const meta = {
  title: "Pages/Account/Purchases",
  component: PurchasesSectionView,
  args: {
    grounds: accessGrounds,
    notices: billingNotices,
    payments: ownPayments,
    subscription: activeSubscription,
    storefrontHref: "/subscription",
    onRefresh: fn(),
    onChangeMethod: fn(),
    onRevokeMethod: fn(),
  },
  parameters: {
    docs: {
      description: {
        component:
          "Раздел «Покупки»: что доступно и по какому основанию, история списаний и чеков, способ оплаты. Условия подписки и управление ею живут в своём разделе.",
      },
    },
  },
} satisfies Meta<typeof PurchasesSectionView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OwnGroundsAndPayments: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Оплаченный доступ")).toBeInTheDocument();
    // Ручная выдача переживает подписку и не называется покупкой.
    await expect(canvas.getByText("Выдано вручную")).toBeInTheDocument();
    await expect(canvas.getByText("Отдельное руководство")).toBeInTheDocument();
    await expect(canvas.getAllByText(/^операция /u).length).toBe(2);
    await expect(canvas.getByText(/Оплата не прошла/u)).toBeInTheDocument();
  },
};

export const NoSubscription: Story = {
  args: { subscription: null, notices: [], payments: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("бессрочно")).toBeInTheDocument();
    await expect(
      canvas.getByText("Карта сохраняется при оформлении подписки."),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Привязать другую карту" }),
    ).not.toBeInTheDocument();
  },
};

export const NoGrounds: Story = {
  args: { grounds: [], notices: [], payments: [], subscription: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Действующих оснований доступа нет."),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Посмотреть тарифы" }),
    ).toBeInTheDocument();
  },
};

export const RevokedMethod: Story = {
  args: {
    subscription: {
      ...activeSubscription,
      paymentMethod: {
        methodRef: "9f1f4de3-9c2e-4a6f-9f0b-1f3a5c7d9e11",
        revoked: true,
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Использование карты запрещено."),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Запретить использование" }),
    ).not.toBeInTheDocument();
  },
};

export const SessionExpired: Story = { args: { sessionExpired: true } };
export const Loading: Story = {
  args: { grounds: [], loading: true, notices: [], payments: [], subscription: null },
};
export const Unavailable: Story = {
  args: { error: "Данные оплаты сейчас недоступны. Повторите позже." },
};
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
