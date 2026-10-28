import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import { AdminConfirmDialog } from "./admin-dialog.client";

const desktop = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
} as const;
const mobile = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
} as const;

const meta = {
  title: "Components/Админка/AdminConfirmDialog",
  component: AdminConfirmDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    onConfirm: fn(),
    title:
      "Отозвать ссылку на «Агентная разработка: от первого агента до команды агентов»?",
    consequence:
      "Оплатить по ссылке будет нельзя. Цена 16 915 ₽, по 15 нояб. 2026. Покупатель увидит, что ссылка отозвана.",
    confirmLabel: "Отозвать ссылку",
    tone: "danger",
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AdminConfirmDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DangerDesktop: Story = {
  ...desktop,
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog");
    await expect(
      within(dialog).getByRole("button", { name: "Отмена" }),
    ).toHaveFocus();
  },
};

/** На телефоне это лист снизу во всю ширину. */
export const DangerMobile: Story = { ...DangerDesktop, ...mobile };

export const WithError: Story = {
  ...mobile,
  args: {
    error:
      "Ссылка изменилась в другом месте. Обновите данные и проверьте её состояние.",
  },
  play: async () => {
    const dialog = await within(document.body).findByRole("dialog");
    await expect(within(dialog).getByRole("alert")).toBeVisible();
  },
};
