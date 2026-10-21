import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import {
  cabinetProduct,
  cabinetProductGround,
  courseEnrollment,
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
export const Revoked: Story = {
  args: {
    grounds: [],
    enrollments: [
      { ...courseEnrollment, state: "revoked", content: [cabinetProduct] },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Отозвано", { exact: true })).toBeVisible();
    await expect(
      canvas.queryByRole("link", { name: "Открыть продукт" }),
    ).not.toBeInTheDocument();
  },
};
export const Empty: Story = { args: { grounds: [] } };
export const ActiveProductWithRevokedAssignment: Story = {
  args: {
    enrollments: [
      {
        ...courseEnrollment,
        state: "revoked",
        content: [cabinetProduct],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Доступ открыт", { exact: true }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Доступ и покупка" }),
    );
    await expect(
      canvas.getByText(`${courseEnrollment.tier.name} · Отозвано`, {
        exact: false,
      }),
    ).toBeVisible();
  },
};
