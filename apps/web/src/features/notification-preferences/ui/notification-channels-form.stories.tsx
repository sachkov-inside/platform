import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import { NotificationChannelsForm } from "./notification-channels-form.client";

const meta = {
  title: "Pages/Account/Notifications",
  component: NotificationChannelsForm,
  args: {
    accountHref: "/account/access",
    dirty: false,
    email: false,
    telegram: false,
    onChange: fn(),
    onSave: fn(),
  },
  parameters: {
    docs: {
      description: {
        component:
          "Каналы сообщений о новых материалах. По умолчанию оба канала выключены; чеки и служебные сообщения об оплате приходят на подтверждённый email независимо от этого выбора.",
      },
    },
    nextjs: { appDirectory: true },
  },
} satisfies Meta<typeof NotificationChannelsForm>;
export default meta;
type Story = StoryObj<typeof meta>;

export const OptedOut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("checkbox", { name: /Email/u })).not.toBeChecked();
    await expect(
      canvas.getByRole("checkbox", { name: /Telegram/u }),
    ).not.toBeChecked();
    await expect(canvas.getByRole("button", { name: "Сохранить" })).toBeDisabled();
  },
};

export const ChangedAndSavable: Story = {
  args: { dirty: true, email: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Сохранить" })).toBeEnabled();
  },
};

export const Saved: Story = {
  args: { email: true, saved: true, telegram: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent("Выбор сохранён.");
  },
};

export const Saving: Story = { args: { dirty: true, email: true, pending: true } };
export const Loading: Story = { args: { loading: true } };
export const SessionExpired: Story = { args: { sessionExpired: true } };
export const Unavailable: Story = {
  args: {
    error: "Настройки уведомлений сейчас недоступны. Повторите попытку позже.",
    unavailable: true,
  },
};
export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
