import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import {
  confirmedPurchase,
  legalDocuments,
  pendingPurchase,
  savedQuote,
  supportOffer,
  verifiedContact,
} from "@/storybook/billing.fixtures";

import { billingErrorMessage } from "@/entities/subscription";

import { CheckoutPanel } from "./checkout-panel.client";
import { publicPageEnvironment } from "@/storybook/story-environment";

const environment = publicPageEnvironment("/subscription");

const meta = {
  ...environment,
  title: "Pages/Subscription/Checkout",
  component: CheckoutPanel,
  args: {
    snapshot: supportOffer,
    quote: null,
    documents: legalDocuments,
    contact: verifiedContact,
    contactHref: "/account/purchases",
    acknowledgeExistingAccess: false,
    purchase: null,
    onQuote: fn(),
    onToggleAcknowledge: fn(),
    onPay: fn(),
    onRefreshStatus: fn(),
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Оформление подписки на витрине (`CheckoutFlow` выбирает эту панель для варианта с автопродлением; разовую покупку руководства показывает `OneTimeCheckoutPanel`). Условия сервера показываются до оплаты. Оферта и автопродление принимаются нажатием кнопки со строкой условий под ней, отметок нет; возврат из банка не считается успехом.",
      },
    },
  },
} satisfies Meta<typeof CheckoutPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const BeforeQuote: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("checkbox")).not.toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole("button", { name: "Рассчитать условия" }),
    );
    await expect(args.onQuote).toHaveBeenCalled();
  },
};

/** Отметок нет: кнопка принимает оферту подписки и автопродление на условиях под ней. */
export const AcceptanceByButton: Story = {
  args: { quote: savedQuote },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("checkbox")).not.toBeInTheDocument();
    await expect(
      canvas.getByText(
        /^Нажимая «Оформить подписку и оплатить», вы принимаете оферту подписки и разрешаете автопродление: следующее списание .+, затем раз в .+\. Отключить продление можно в кабинете, в разделе «Подписка»\.$/u,
      ),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: /^Оформить подписку и оплатить /u }),
    ).toBeEnabled();
  },
};

export const ReadyToPay: Story = {
  args: { quote: savedQuote },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const pay = canvas.getByRole("button", { name: /оплатить/iu });
    await expect(pay).toBeEnabled();
    await userEvent.click(pay);
    await expect(args.onPay).toHaveBeenCalled();
  },
};

export const ContactRequired: Story = {
  args: { quote: savedQuote, contact: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: "Подтвердить email" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: /оплатить/iu }),
    ).toBeDisabled();
  },
};

/** Сервер ответил `existing_access`: оплата ждёт явного согласия, а текст ошибки — тот же, что даёт поток. */
export const ExistingAccess: Story = {
  args: {
    quote: savedQuote,
    existingAccess: true,
    error: billingErrorMessage("existing_access"),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(
        /Новая подписка не отменяет и не заменяет действующие права/u,
      ),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: /оплатить/iu }),
    ).toBeDisabled();
  },
};

export const LegacyBlocked: Story = {
  args: {
    quote: savedQuote,
    legacyBlocked: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("button", { name: /оплатить/iu }),
    ).not.toBeInTheDocument();
  },
};

export const LegalNotPublished: Story = {
  args: { quote: savedQuote, documents: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/Условия продажи ещё не опубликованы/u),
    ).toBeInTheDocument();
  },
};

export const AwaitingBank: Story = {
  args: {
    quote: savedQuote,
    purchase: pendingPurchase,
  },
};

export const Confirmed: Story = {
  args: {
    quote: savedQuote,
    purchase: confirmedPurchase,
  },
};

export const Pending: Story = {
  args: { quote: savedQuote, pending: true },
};

export const Mobile: Story = {
  args: { quote: savedQuote },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const Desktop: Story = {
  args: { quote: savedQuote },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
