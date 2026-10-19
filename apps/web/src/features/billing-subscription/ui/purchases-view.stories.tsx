import { legalSeller } from "@inside/legal";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within, userEvent } from "storybook/test";

import {
  accessGrounds,
  cabinetProduct,
  cabinetProductGround,
  cabinetProductPayment,
  activeSubscription,
  billingNotices,
  ownPayments,
  refundedOwnPayments,
  refundNotices,
} from "@/storybook/billing.fixtures";

import { PurchasesSectionView } from "./purchases-view.client";
import { accountSectionEnvironment } from "@/storybook/story-environment";

const environment = accountSectionEnvironment("/account/purchases");

const meta = {
  ...environment,
  title: "Components/Account/Purchases view",
  component: PurchasesSectionView,
  args: {
    grounds: accessGrounds,
    notices: billingNotices,
    payments: ownPayments,
    subscription: activeSubscription,
    onChangeMethod: fn(),
    onRevokeMethod: fn(),
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Вид раздела «Покупки» без соседних блоков: основания доступа, способ оплаты и история списаний на разных данных. Раздел целиком, с сообществом и email, его загрузку, пустое состояние и ошибки показывает «Pages/Account/Purchases».",
      },
    },
  },
} satisfies Meta<typeof PurchasesSectionView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OwnGroundsAndPayments: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("История оплат, чеки и возвраты"));
    await expect(
      within(
        canvas.getByText(/Для возврата обратитесь к продавцу:/u),
      ).getByRole("link", { name: legalSeller.email }),
    ).toHaveAttribute("href", `mailto:${legalSeller.email}`);
    // Оплатой открывается и подписка, и отдельно купленное руководство.
    await expect(canvas.getAllByText("Оплаченный доступ").length).toBe(2);
    // Ручная выдача переживает подписку и не называется покупкой.
    await expect(canvas.getByText("Выдано вручную")).toBeInTheDocument();
    await expect(canvas.getAllByText("Отдельный продукт").length).toBe(2);
    // Общий чат открывает и старший тариф, и каждое право на руководство.
    await expect(canvas.getAllByText("Сообщество продукта").length).toBe(1);
    await expect(canvas.getAllByText(/^операция /u).length).toBe(3);
    await expect(canvas.getByText(/Оплата не прошла/u)).toBeInTheDocument();
    // Разовая покупка названа покупкой: срока варианта оплаты у неё нет.
    await expect(
      canvas.getByText(
        /Руководство «Создание Platform Inside» · разовая покупка/u,
      ),
    ).toBeInTheDocument();
  },
};

/** После подтверждённого возврата покупка остаётся в истории с возвращённой суммой и сообщением. */
export const RefundedPurchase: Story = {
  args: { grounds: [], notices: refundNotices, payments: refundedOwnPayments },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("История оплат, чеки и возвраты"));
    await expect(canvas.getByText(/Возвращено 2\s?500/u)).toBeInTheDocument();
    await expect(canvas.getByText("Возврат выполнен")).toBeInTheDocument();
  },
};

export const NoSubscription: Story = {
  args: { subscription: null, notices: [], payments: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Купленное руководство и ручная выдача действуют без даты окончания и без подписки —
    // сводка оснований такой срок не называет.
    await expect(
      canvas.queryByText("без даты окончания"),
    ).not.toBeInTheDocument();
    await expect(canvas.getAllByText("Оплаченный доступ").length).toBe(2);
    await expect(
      canvas.queryByText("Карта сохраняется при оформлении подписки."),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Привязать другую карту" }),
    ).not.toBeInTheDocument();
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

export const UnifiedProduct: Story = {
  args: {
    grounds: [cabinetProductGround],
    payments: [cabinetProductPayment],
    subscription: null,
    notices: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getAllByRole("heading", { name: "AI Engineering" }),
    ).toHaveLength(1);
    await expect(
      canvas.queryByRole("heading", { name: "Покупки продуктов" }),
    ).not.toBeInTheDocument();
    await expect(
      within(
        canvas.getByRole("listitem", { name: "AI Engineering" }),
      ).getByText("30 ₽"),
    ).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: "Открыть продукт" }),
    ).toHaveAttribute("href", "/products/ai-engineering/programme");
    await userEvent.click(
      canvas.getByRole("button", { name: "Доступ и покупка" }),
    );
    await expect(
      canvas.getByText(
        /Оплаченный доступ: материалы продукта без даты окончания/,
      ),
    ).toBeVisible();
  },
};

export const UnifiedProductMobile: Story = {
  ...UnifiedProduct,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const GrantedProduct: Story = {
  args: {
    grounds: [{ ...cabinetProductGround, source: "manual" }],
    payments: [],
    subscription: null,
    notices: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "AI Engineering" }),
    ).toBeVisible();
    await expect(canvas.queryByText(/₽/)).not.toBeInTheDocument();
  },
};

export const BundleProduct: Story = {
  args: {
    grounds: [],
    subscription: null,
    notices: [],
    payments: [
      {
        ...cabinetProductPayment,
        content: [
          cabinetProduct,
          {
            ...cabinetProduct,
            id: "00000000-0000-4000-8000-000000000f02",
            title: "Agent Engineering",
            slug: "agent-engineering",
          },
        ],
        productAccess: [
          { productId: cabinetProduct.id, access: "ready" },
          {
            productId: "00000000-0000-4000-8000-000000000f02",
            access: "unavailable",
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("За весь набор")).toHaveLength(2);
    await expect(
      canvas.getAllByRole("link", { name: "Открыть продукт" }),
    ).toHaveLength(1);
    await expect(
      canvas.getByRole("link", { name: "К странице продукта" }),
    ).toBeVisible();
  },
};

export const PendingProduct: Story = {
  args: {
    grounds: [],
    subscription: null,
    notices: [],
    payments: [
      {
        ...cabinetProductPayment,
        state: "pending",
        access: "awaiting_payment",
        confirmedAt: null,
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Ожидаем оплату")).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: /^Продолжить покупку$/ }),
    ).toHaveAttribute("href", expect.stringContaining("purchaseRef="));
  },
};

export const UnavailableProduct: Story = {
  args: {
    grounds: [
      {
        ...cabinetProductGround,
        content: [{ ...cabinetProduct, available: false, slug: null }],
      },
    ],
    payments: [],
    subscription: null,
    notices: [],
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole("link", { name: "Открыть продукт" }),
    ).not.toBeInTheDocument();
  },
};
