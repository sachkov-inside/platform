import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
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
