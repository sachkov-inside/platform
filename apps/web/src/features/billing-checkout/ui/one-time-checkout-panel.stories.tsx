import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import {
  confirmedGuidePurchase,
  guideOnlyOffer,
  guideQuote,
  legalDocuments,
  verifiedContact,
} from "@/workshop/billing.fixtures";

import { OneTimeCheckoutPanel } from "./one-time-checkout-panel.client";

const inclusions = [
  { caption: "Доступ", title: "Навсегда", detail: "без подписки" },
  {
    caption: "Состав",
    title: "Руководство с сопровождением",
    detail: "Руководство «Создание Platform Inside»",
  },
];

const meta = {
  title: "Pages/Guide/Payment",
  component: OneTimeCheckoutPanel,
  args: {
    snapshot: guideOnlyOffer,
    quote: guideQuote,
    documents: legalDocuments,
    accepted: [],
    contact: verifiedContact,
    contactHref: "/account/email",
    acknowledgeExistingAccess: false,
    purchase: null,
    inclusions,
    onToggleDocument: fn(),
    onToggleAcknowledge: fn(),
    onPay: fn(),
    onRefreshStatus: fn(),
    onRetryQuote: fn(),
  },
  parameters: {
    docs: {
      description: {
        component:
          "Оплата руководства одной страницей: что входит, сколько стоит, куда придёт чек и одна кнопка. Цену покупатель видит только здесь — программа лишь приглашает оплатить.",
      },
    },
  },
} satisfies Meta<typeof OneTimeCheckoutPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  args: { accepted: ["terms"] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Всё включено")).toBeInTheDocument();
    await expect(canvas.getByText("Без подписки")).toBeInTheDocument();
    await expect(canvas.getByText("Руководство с сопровождением")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /Купить за/u })).toBeEnabled();
    // Согласие на регулярные списания разовой покупке не показывается.
    await expect(
      canvas.queryByText("Согласие на регулярные списания"),
    ).not.toBeInTheDocument();
  },
};

export const ConsentNotAccepted: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const checkbox of canvas.getAllByRole("checkbox"))
      await expect(checkbox).not.toBeChecked();
    await expect(canvas.getByRole("button", { name: /Купить за/u })).toBeDisabled();
  },
};

export const ContactRequired: Story = {
  args: { accepted: ["terms"], contact: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: "Подтвердить почту" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /Купить за/u })).toBeDisabled();
  },
};

export const QuotePending: Story = {
  args: { quote: null, pending: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Готовим точные условия",
    );
  },
};

export const ExistingAccess: Story = {
  args: {
    accepted: ["terms"],
    existingAccess: true,
    error: "У вас уже есть доступ к части этого состава.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Это руководство у вас уже открыто."),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /Купить за/u })).toBeDisabled();
  },
};

export const Confirmed: Story = {
  args: { accepted: ["terms"], purchase: confirmedGuidePurchase },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Доступ открыт.")).toBeInTheDocument();
  },
};

export const Mobile: Story = {
  args: { accepted: ["terms"] },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const Desktop: Story = {
  args: { accepted: ["terms"] },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
