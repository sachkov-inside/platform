import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ProductRemovalConfirmationDialog } from "./product-removal-confirmation-dialog.client";

const meta = {
  title: "Components/Админка/Product removal confirmation",
  component: ProductRemovalConfirmationDialog,
  args: {
    products: [
      {
        productId: "00000000-0000-4000-8000-000000000001",
        name: "AI Engineering",
        holders: 24,
      },
      {
        productId: "00000000-0000-4000-8000-000000000002",
        name: "",
        holders: 1,
      },
    ],
    onCancel: fn(),
    onConfirm: fn(),
  },
  parameters: {
    docs: {
      description: {
        component:
          "Подтверждение снятия материала из продуктов, в которых есть люди с доступом. Показывает затронутые продукты; данные и обработчики демонстрационные.",
      },
    },
  },
} satisfies Meta<typeof ProductRemovalConfirmationDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Confirm: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = within(await within(canvasElement).findByRole("dialog"));
    await expect(dialog.getByText("Продукт без названия")).toBeVisible();
    await expect(dialog.getByText("доступ у 24 человека")).toBeVisible();
    await userEvent.click(
      dialog.getByRole("button", { name: "Снять из продукта" }),
    );
    await expect(args.onConfirm).toHaveBeenCalledOnce();
  },
};
export const Cancel: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Оставить в продукте",
      }),
    );
    await expect(args.onCancel).toHaveBeenCalledOnce();
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};
export const Pending: Story = {
  args: { pending: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Снять из продукта" }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Оставить в продукте" }),
    ).toBeDisabled();
  },
};
export const Mobile: Story = {
  ...Confirm,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
