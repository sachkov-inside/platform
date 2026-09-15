import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import {
  confirmedGuidePurchase,
  guideOnlyOffer,
  guideQuote,
  guideWithSupportOffer,
  legalDocuments,
  verifiedContact,
} from "@/workshop/billing.fixtures";

import { oneTimePurchaseInclusions } from "../model/one-time-terms";
import { OneTimeCheckoutPanel } from "./one-time-checkout-panel.client";
import { publicPageEnvironment } from "@/workshop/story-environment";

// Состав и сроки читаются настоящим кодом: иначе история подтверждала бы свою же строку.
const inclusions = oneTimePurchaseInclusions(guideWithSupportOffer);

const environment = publicPageEnvironment("/guides/platform-inside/buy");

const meta = {
  ...environment,
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
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Оплата продукта одной страницей: что входит, сколько стоит, куда придёт чек и одна кнопка. Цену покупатель видит только здесь — программа лишь приглашает оплатить.",
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
    await expect(canvas.getByText("Без подписки и доплат")).toBeInTheDocument();
    // Оферта не обещает «всё» и «навсегда»: сроки названы по составляющим.
    await expect(canvas.queryByText(/Всё включено|Навсегда/u)).not.toBeInTheDocument();
    await expect(canvas.getByText("2 года гарантированно")).toBeInTheDocument();
    await expect(canvas.getByText("6 месяцев")).toBeInTheDocument();
    // Купленное руководство само по себе открывает общий чат, и состав называет его.
    await expect(
      canvas.getByText("Продукт с сопровождением и общим чатом"),
    ).toBeInTheDocument();
    // Распределение цены и сводка условий видны до оплаты.
    await expect(canvas.getByText(/^Из них поровну: материалы и чат — /u)).toBeInTheDocument();
    const terms = canvas.getByRole("region", { name: "Условия покупки" });
    await expect(
      within(terms).getByText("После отказа доступ по этой покупке закрывается."),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("checkbox", { name: /Принимаю оферту разовой покупки/u }),
    ).toBeChecked();
    // Футер оболочки ведёт к тем же документам, поэтому ссылки ищутся в самой оплате.
    const payment = within(canvas.getByRole("region", { name: "Оплата продукта" }));
    for (const name of [
      "Оферта разовой покупки",
      "Условия использования",
      "Реквизиты и обращения",
      "Политика данных",
    ])
      await expect(payment.getByRole("link", { name })).toBeInTheDocument();
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
    // Формы подтверждения здесь нет: страница объясняет предел и ведёт в кабинет.
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "пока не подтверждён",
    );
    await expect(
      canvas.getByRole("link", { name: "Подтвердить его в кабинете" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByLabelText("Email")).not.toBeInTheDocument();
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
      canvas.getByText("Этот продукт у вас уже открыт."),
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
