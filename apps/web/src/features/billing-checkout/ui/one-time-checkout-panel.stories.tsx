import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import {
  confirmedProductPurchase,
  fixedTermProductOffer,
  fixedTermProductQuote,
  productWithSupportOffer,
  productWithSupportQuote,
  legalDocuments,
  verifiedContact,
} from "@/storybook/billing.fixtures";

import { OneTimeCheckoutPanel } from "./one-time-checkout-panel.client";
import { publicPageEnvironment } from "@/storybook/story-environment";

const environment = publicPageEnvironment("/products/platform-inside/buy");

const meta = {
  ...environment,
  title: "Pages/Product/Payment",
  component: OneTimeCheckoutPanel,
  args: {
    snapshot: productWithSupportOffer,
    quote: productWithSupportQuote,
    documents: legalDocuments,
    email: verifiedContact.email,
    onEmailChange: fn(),
    acknowledgeExistingAccess: false,
    purchase: null,
    showInclusions: true,
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: /^Оплатить /u }),
    ).toBeEnabled();
    await expect(canvas.queryByRole("checkbox")).not.toBeInTheDocument();
    await expect(
      canvas.getByText(
        "Нажимая «Оплатить», вы принимаете оферту разовой покупки.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Условия и документы покупки"));
    await expect(
      canvas.getByText("Материалы — без ограничения срока."),
    ).toBeVisible();
    await expect(
      canvas.queryByText(/Сообщество продукта/u),
    ).not.toBeInTheDocument();
    for (const name of [
      "Оферта разовой покупки",
      "Условия использования",
      "Реквизиты и обращения",
      "Политика данных",
    ])
      await expect(
        within(canvas.getByRole("form", { name: "Оплата продукта" })).getByRole(
          "link",
          { name },
        ),
      ).toBeVisible();
  },
};

/** Предложение с другими сроками показывает до оплаты свои сроки, а не сроки курса. */
export const FixedTermOffer: Story = {
  args: {
    snapshot: fixedTermProductOffer,
    quote: fixedTermProductQuote,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Условия и документы покупки"));
    await expect(
      canvas.getByText(
        "Материалы — 2 года гарантированно, дальше без гарантии срока.",
      ),
    ).toBeVisible();
    await expect(canvas.getByText(/^Сопровождение — 1 год:/u)).toBeVisible();
  },
};

/** Предзаказ: рядом с ценой — зачёркнутая цена после старта и срок, до которого действует цена. */
export const Preorder: Story = {
  args: {
    preorder: {
      startsOn: "9 ноября",
      daysLeft: "до старта 31 день",
      priceAfterStartKopecks:
        productWithSupportOffer.firstPriceKopecks + 1_000_000,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Цена после старта:/u)).toBeInTheDocument();
  },
};

export const EmailRequired: Story = {
  args: { email: "" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const email = canvas.getByRole("textbox", { name: "Email" });
    await expect(email).toHaveValue("");
    await expect(
      canvas.queryByRole("link", { name: /Подтвердить/u }),
    ).not.toBeInTheDocument();
    await userEvent.type(email, "a");
    await expect(args.onEmailChange).toHaveBeenCalledWith("a");
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
    existingAccess: true,
    error: "У вас уже есть доступ к части этого состава.",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Этот продукт у вас уже открыт."),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: /^Оплатить /u }),
    ).toBeDisabled();
  },
};

export const Confirmed: Story = {
  args: { purchase: confirmedProductPurchase },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Доступ открыт.")).toBeInTheDocument();
  },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
