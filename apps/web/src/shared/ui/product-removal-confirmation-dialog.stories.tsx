import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useState, type ComponentProps } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
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
/**
 * На телефоне окно и его подложка держат прокрутку у себя: у модального окна
 * `overscroll-behavior: contain`, а подложка стала контейнером прокрутки с тем же правилом.
 */
export const PageStaysBehindDialog: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement).findByRole("dialog");
    await expect(dialog).toSatisfy((element: Element) =>
      element.matches(":modal"),
    );
    await expect(getComputedStyle(dialog).overscrollBehaviorY).toBe("contain");
    const backdrop = getComputedStyle(dialog, "::backdrop");
    await expect(backdrop.overflowY).toBe("hidden");
    await expect(backdrop.overscrollBehaviorY).toBe("contain");
  },
};

function RetainedRemoval({
  products,
  pending,
  onCancel,
  onConfirm,
}: ComponentProps<typeof ProductRemovalConfirmationDialog>) {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setVisible(true);
        }}
      >
        Вернуть подтверждение
      </button>
      <Activity mode={visible ? "visible" : "hidden"}>
        {mounted ? (
          <ProductRemovalConfirmationDialog
            products={products}
            {...(pending === undefined ? {} : { pending })}
            onConfirm={() => {
              onConfirm();
              setVisible(false);
            }}
            onCancel={() => {
              onCancel();
              setMounted(false);
            }}
          />
        ) : null}
      </Activity>
    </>
  );
}

export const RetainedModalReleasesAndReturns: Story = {
  render: (args) => <RetainedRemoval {...args} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await canvas.findByRole("dialog");
    await expect(dialog.matches(":modal")).toBe(true);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Снять из продукта" }),
    );
    await waitFor(() => expect(dialog).not.toBeVisible());
    await expect(dialog.isConnected).toBe(true);
    await expect(dialog.matches(":modal")).toBe(false);
    await expect(args.onConfirm).toHaveBeenCalledOnce();
    await expect(args.onCancel).not.toHaveBeenCalled();
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуть подтверждение" }),
    );
    await waitFor(() => expect(dialog.matches(":modal")).toBe(true));
    await expect(canvas.getByRole("dialog")).toBe(dialog);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Оставить в продукте" }),
    );
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await expect(dialog.matches(":modal")).toBe(false);
    await expect(args.onCancel).toHaveBeenCalledOnce();
  },
};
