import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { guideOnlyOffer } from "@/workshop/billing.fixtures";

import { GuidePurchaseView } from "./guide-purchase-view";

const guide = {
  name: "Создание Platform Inside",
  summary: "Как устроен продукт: архитектура, границы и порядок поставки.",
};
import { publicPageEnvironment, routeContent } from "@/workshop/story-environment";

const environment = publicPageEnvironment("/guides/platform-inside/buy");

const meta = {
  title: "Pages/Guide/Purchase",
  component: GuidePurchaseView,
  args: {
    guide,
    offer: guideOnlyOffer,
    slug: "platform-inside",
    viewer: "member",
    children: (
      <p className="rounded-2xl border border-border bg-card p-6 text-sm shadow-card">
        Оформление покупки
      </p>
    ),
  },
  ...environment,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Руководство продаётся, только когда владелец завёл ему цену. Отсутствие предложения — обычное состояние, а не ошибка, и подписка на эту страницу не влияет.",
      },
    },
  },
} satisfies Meta<typeof GuidePurchaseView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ForSale: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1 })).toHaveTextContent(
      guide.name,
    );
    // Страница оплаты ведёт обратно в программу: там читатель видел бесплатные уроки.
    await expect(
      canvas.getByRole("link", { name: "Программа" }),
    ).toBeInTheDocument();
    // Само оформление собирает клиентская обвязка: здесь она заменена заглушкой.
    await expect(canvas.getByText("Оформление покупки")).toBeInTheDocument();
  },
};

export const NotForSale: Story = {
  args: { offer: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "не продаётся отдельно",
    );
    await expect(
      canvas.getByRole("link", { name: "Программа" }),
    ).toBeInTheDocument();
  },
};

export const PriceUnavailable: Story = {
  args: { unavailable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Временный сбой не выдаётся за «не продаётся».
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Цена сейчас недоступна",
    );
  },
};

export const SignedOut: Story = {
  args: { viewer: "guest" },
  play: async ({ canvasElement }) => {
    // Вход есть и в шапке оболочки: проверяем приглашение самой страницы.
    const canvas = routeContent(canvasElement);
    await expect(canvas.getByRole("button", { name: "Войти" })).toBeEnabled();
    // Цена в приглашении войти приходит из снимка сервера, а не из разметки.
    await expect(
      canvas.getByText((_, node) => node?.textContent?.includes("2\u00a0500") === true, {
        selector: "p",
      }),
    ).toBeInTheDocument();
  },
};

export const Loading: Story = { args: { viewer: "loading" } };

export const PurchasesUnavailable: Story = {
  args: { notice: "Данные оплаты сейчас недоступны. Повторите позже." },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
