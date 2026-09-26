import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import {
  confirmedPurchase,
  guideOnlyOffer,
  guideQuote,
  legalDocuments,
  pendingPurchase,
  savedQuote,
  supportOffer,
  verifiedContact,
} from "@/workshop/billing.fixtures";

import { CheckoutPanel } from "./checkout-panel.client";
import { publicPageEnvironment } from "@/workshop/story-environment";

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
          "Условия сервера показываются до оплаты. Оферта и автопродление принимаются нажатием кнопки со строкой условий под ней, отметок нет; возврат из банка не считается успехом.",
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

export const ExistingAccess: Story = {
  args: {
    quote: savedQuote,
    existingAccess: true,
    error: "У вас уже есть доступ к части этого состава.",
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

/** Разовая покупка руководства: без согласия на списания, без периода и следующей цены. */
export const OneTimeGuide: Story = {
  args: {
    snapshot: guideOnlyOffer,
    quote: guideQuote,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Оформление покупки")).toBeInTheDocument();
    await expect(
      canvas.queryByText("Согласие на регулярные списания"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByText("Дальше каждый период"),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByText("Период")).not.toBeInTheDocument();
    await expect(canvas.getByText(/Это разовый платёж/u)).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: /оплатить/iu }),
    ).toBeEnabled();
  },
};

/** Повторная покупка того же руководства: честное предупреждение вместо тихого второго права. */
export const OneTimeExistingAccess: Story = {
  args: {
    snapshot: guideOnlyOffer,
    quote: guideQuote,
    existingAccess: true,
    error: "У вас уже есть доступ к части этого состава.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/Повторная покупка не удваивает право/u),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: /оплатить/iu }),
    ).toBeDisabled();
  },
};

export const OneTimeMobile: Story = {
  args: { snapshot: guideOnlyOffer, quote: guideQuote },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const OneTimeDesktop: Story = {
  args: { snapshot: guideOnlyOffer, quote: guideQuote },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};

export const Mobile: Story = {
  args: { quote: savedQuote },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const Desktop: Story = {
  args: { quote: savedQuote },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
