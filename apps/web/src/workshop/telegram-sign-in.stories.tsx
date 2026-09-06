import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import {
  renderTelegramSignInContent,
  telegramSignInStyles,
  type InsideTelegramView,
} from "../../../../infra/identity/logto/fork/packages/core/src/routes/inside-telegram-view";

// The fixture adapter imports the identity-owned presentation, never its protocol or credentials.
function TelegramSignIn(view: InsideTelegramView) {
  return (
    <>
      <style>{telegramSignInStyles}</style>
      <div className="inside-telegram" lang="ru">
        <main dangerouslySetInnerHTML={{ __html: renderTelegramSignInContent(view) }} />
      </div>
    </>
  );
}

const meta = {
  title: "Patterns/Identity/Telegram sign-in",
  component: TelegramSignIn,
  args: { status: "pending", deepLink: "https://t.me/inside_storybook_bot?start=fixture" },
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "Экран Logto из #303. Одна реализация для Storybook и входа; состояния здесь заданы примерами. Кнопка бота в примерах не начинает настоящий вход. Оформление с голубым акцентом принято владельцем 2026-09-06 (#303)." } },
  },
} satisfies Meta<typeof TelegramSignIn>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {
  name: "Ожидание подтверждения",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "Открыть бота" })).toHaveAttribute("target", "_blank");
    await expect(canvas.getAllByRole("link")).toHaveLength(1);
    await expect(canvas.getByRole("status")).toHaveTextContent("Подтвердите вход в Telegram.");
  },
};
export const Loading: Story = { name: "Загрузка", args: { status: "loading" } };
export const Approved: Story = { name: "Вход подтверждён", args: { status: "approved" } };
export const Denied: Story = { name: "Вход отменён", args: { status: "denied" } };
export const Expired: Story = { name: "Время вышло", args: { status: "expired" } };
export const Consumed: Story = { name: "Запрос использован", args: { status: "consumed" } };
export const Disabled: Story = { name: "Вход отключён", args: { status: "disabled" } };
export const Unavailable: Story = {
  name: "Вход недоступен",
  args: { status: "unavailable" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: "Вернуться ко входу" })).toHaveAttribute("href", "/sign-in");
    await expect(canvas.queryByRole("link", { name: "Открыть бота" })).not.toBeInTheDocument();
  },
};
export const Reconnecting: Story = { name: "Потеря связи", args: { status: "reconnecting" } };
