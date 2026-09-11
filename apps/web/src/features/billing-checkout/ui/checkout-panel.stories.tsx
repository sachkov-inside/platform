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

const meta = {
  title: "Pages/Subscription/Checkout",
  component: CheckoutPanel,
  args: {
    snapshot: supportOffer,
    quote: null,
    documents: legalDocuments,
    accepted: [],
    contact: verifiedContact,
    contactHref: "/account/email",
    acknowledgeExistingAccess: false,
    purchase: null,
    onQuote: fn(),
    onToggleDocument: fn(),
    onToggleAcknowledge: fn(),
    onPay: fn(),
    onRefreshStatus: fn(),
  },
  parameters: {
    docs: {
      description: {
        component:
          "Условия сервера показываются до согласия. Ни один флажок не отмечен заранее, а возврат из банка не считается успехом.",
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

export const ConsentsNotPrechecked: Story = {
  args: { quote: savedQuote },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const checkbox of canvas.getAllByRole("checkbox"))
      await expect(checkbox).not.toBeChecked();
    await expect(
      canvas.getByRole("button", { name: /Оплатить/u }),
    ).toBeDisabled();
  },
};

export const ReadyToPay: Story = {
  args: { quote: savedQuote, accepted: ["terms", "recurring"] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const pay = canvas.getByRole("button", { name: /Оплатить/u });
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
      canvas.getByRole("button", { name: /Оплатить/u }),
    ).toBeDisabled();
  },
};

export const ExistingAccess: Story = {
  args: {
    quote: savedQuote,
    accepted: ["terms", "recurring"],
    existingAccess: true,
    error: "У вас уже есть доступ к части этого состава.",
  },
};

export const LegacyBlocked: Story = {
  args: {
    quote: savedQuote,
    accepted: ["terms", "recurring"],
    legacyBlocked: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("button", { name: /Оплатить/u }),
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
    accepted: ["terms", "recurring"],
    purchase: pendingPurchase,
  },
};

export const Confirmed: Story = {
  args: {
    quote: savedQuote,
    accepted: ["terms", "recurring"],
    purchase: confirmedPurchase,
  },
};

export const Pending: Story = {
  args: { quote: savedQuote, accepted: ["terms", "recurring"], pending: true },
};

/** Разовая покупка руководства: без согласия на списания, без периода и следующей цены. */
export const OneTimeGuide: Story = {
  args: {
    snapshot: guideOnlyOffer,
    quote: guideQuote,
    accepted: ["terms"],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Оформление покупки")).toBeInTheDocument();
    await expect(
      canvas.queryByText("Согласие на регулярные списания"),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByText("Дальше каждый период")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Период")).not.toBeInTheDocument();
    await expect(
      canvas.getByText(/Это разовый платёж/u),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: /Оплатить/u }),
    ).toBeEnabled();
  },
};

/** Повторная покупка того же руководства: честное предупреждение вместо тихого второго права. */
export const OneTimeExistingAccess: Story = {
  args: {
    snapshot: guideOnlyOffer,
    quote: guideQuote,
    accepted: ["terms"],
    existingAccess: true,
    error: "У вас уже есть доступ к части этого состава.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/Повторная покупка не удваивает право/u),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: /Оплатить/u }),
    ).toBeDisabled();
  },
};

export const OneTimeMobile: Story = {
  args: { snapshot: guideOnlyOffer, quote: guideQuote, accepted: ["terms"] },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const OneTimeDesktop: Story = {
  args: { snapshot: guideOnlyOffer, quote: guideQuote, accepted: ["terms"] },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};

export const Mobile: Story = {
  args: { quote: savedQuote, accepted: ["terms"] },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const Desktop: Story = {
  args: { quote: savedQuote, accepted: ["terms", "recurring"] },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
