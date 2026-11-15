import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import {
  cabinetProduct,
  cabinetProductGround,
  cabinetProductPayment,
} from "@/storybook/billing.fixtures";
import { ProductAccessList } from "./product-access-list";
const meta = {
  title: "Components/Account/Product access",
  component: ProductAccessList,
  args: { grounds: [cabinetProductGround], payments: [] },
} satisfies Meta<typeof ProductAccessList>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Granted: Story = {};
/**
 * «Доступ и покупка» стоит на родном `<details>`: закрытый текст остаётся в странице, поиск по странице
 * его находит и раскрывает блок.
 */
export const AccessDetails: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const summary = canvas.getByText("Доступ и покупка");
    const details = summary.closest("details");
    if (details === null) throw new Error("The disclosure is a native details");
    await expect(details).not.toHaveAttribute("open");
    await expect(details.textContent).toMatch(/:/u);
    await userEvent.click(summary);
    await expect(details).toHaveAttribute("open");
  },
};
export const Empty: Story = { args: { grounds: [] } };
export const Revoked: Story = {
  args: {
    grounds: [],
    products: [
      {
        id: cabinetProduct.id,
        slug: cabinetProduct.slug,
        name: cabinetProduct.title,
        materials: { state: "revoked" },
        community: { state: "revoked" },
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Доступ отозван", { exact: true }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("link", { name: "Открыть продукт" }),
    ).not.toBeInTheDocument();
  },
};

export const PartialRefundReview: Story = {
  args: {
    grounds: [cabinetProductGround],
    payments: [{ ...cabinetProductPayment, refundedKopecks: null }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getAllByText("Сумма частичного возврата уточняется в банке.", {
        exact: true,
      })[0],
    ).toBeVisible();
    await expect(
      canvas.getByText("Доступ открыт", { exact: true }),
    ).toBeVisible();
  },
};
export const HistoricalFulfillmentReview: Story = {
  args: {
    grounds: [],
    payments: [
      {
        ...cabinetProductPayment,
        access: "review_required",
        productAccess: undefined,
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Нужна проверка оплаченного заказа", { exact: true }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("link", { name: "Открыть продукт" }),
    ).not.toBeInTheDocument();
  },
};
