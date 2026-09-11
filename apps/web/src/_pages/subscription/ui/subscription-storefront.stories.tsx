import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import {
  activeSubscription,
  billingOffers,
  currentBillingResponse,
} from "@/workshop/billing.fixtures";
import { fetchBeforeRender } from "@/workshop/mutation-mock";

import { SubscriptionStorefront } from "./subscription-storefront.client";
import { publicPageEnvironment } from "@/workshop/story-environment";


const signedOut = fetchBeforeRender(() =>
  Promise.resolve(new Response(null, { status: 401 })),
);

const subscribed = fetchBeforeRender(() =>
  Promise.resolve(currentBillingResponse(activeSubscription)),
);

const desktop = { viewport: { isRotated: false, value: "desktop1440" } };
const mobile = { viewport: { isRotated: false, value: "mobile390" } };

const environment = publicPageEnvironment("/subscription");

const meta = {
  ...environment,
  title: "Pages/Subscription/Storefront",
  component: SubscriptionStorefront,
  args: { offers: billingOffers, returnTo: "/subscription" },
  beforeEach: () => {
    environment.beforeEach();
    return signedOut();
  },
  globals: desktop,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Витрина подписки. Пустой каталог означает выключенную владельцем продажу и " +
          "отличается от недоступного сервера.",
      },
    },
  },
} satisfies Meta<typeof SubscriptionStorefront>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Catalog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Подписка Sachkov Inside" }),
    ).toBeVisible();
    await expect(canvas.getByText("Выберите тариф")).toBeVisible();
  },
};

/** Одна проверка выключенной продажи: её повторяют mobile и desktop. */
const expectNoSale: NonNullable<Story["play"]> = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(
    canvas.getByRole("heading", {
      level: 1,
      name: "Подписка сейчас не продаётся",
    }),
  ).toBeVisible();
  await expect(canvas.queryByText("Выберите тариф")).not.toBeInTheDocument();
  await expect(
    canvas.queryByText(/Тарифы сейчас недоступны/u),
  ).not.toBeInTheDocument();
  await expect(
    canvas.queryByText(/Оба тарифа открывают/u),
  ).not.toBeInTheDocument();
};

/**
 * Владелец выключил продажу у всех вариантов. Страница не рекламирует тарифы, не предлагает
 * выбор и не обещает, что позже что-то появится.
 */
export const NotOffered: Story = {
  args: { offers: [] },
  play: expectNoSale,
};

export const NotOfferedMobile: Story = { ...NotOffered, globals: mobile };

/** Выключенная продажа не трогает действующую подписку: вход в кабинет остаётся на месте. */
export const NotOfferedWithSubscription: Story = {
  args: { offers: [] },
  beforeEach: subscribed,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("link", {
        name: "Управлять ею в платёжном кабинете",
      }),
    ).toBeVisible();
    await expect(canvas.queryByText("Выберите тариф")).not.toBeInTheDocument();
  },
};

/** Каталог не прочитался: это сбой, и он честно предлагает зайти позже. */
export const Unavailable: Story = {
  args: { offers: [], unavailable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Подписка Sachkov Inside" }),
    ).toBeVisible();
    await expect(canvas.getByText(/Тарифы сейчас недоступны/u)).toBeVisible();
  },
};

/** Сбой чтения каталога тоже не прячет вход в кабинет у того, у кого подписка есть. */
export const UnavailableWithSubscription: Story = {
  args: { offers: [], unavailable: true },
  beforeEach: subscribed,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("link", {
        name: "Управлять ею в платёжном кабинете",
      }),
    ).toBeVisible();
    await expect(canvas.getByText(/Тарифы сейчас недоступны/u)).toBeVisible();
  },
};
