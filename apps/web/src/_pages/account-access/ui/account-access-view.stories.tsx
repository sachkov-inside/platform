import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { AccountAccessView } from "./account-access-view.client";

const meta = {
  args: {
    link: { kind: "linked" },
    onReload: () => undefined,
    onTelegramRefresh: () => Promise.resolve(),
  },
  component: AccountAccessView,
  parameters: {
    docs: {
      description: {
        component:
          "Раздел «Аккаунт»: связь с Telegram и выход. Права доступа и их сроки объясняет раздел «Покупки».",
      },
    },
    nextjs: { appDirectory: true },
  },
  title: "Pages/Account/Access",
} satisfies Meta<typeof AccountAccessView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Linked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Аккаунт" })).toBeInTheDocument();
    await expect(canvas.getByText("Telegram подключён")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Выйти из аккаунта" }),
    ).toBeEnabled();
    // Ни один раздел не показывает задачи другого.
    await expect(canvas.queryByText(/чек|списани/iu)).not.toBeInTheDocument();
  },
};

export const Unlinked: Story = {
  args: { link: { kind: "unlinked" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Подключить" }),
    ).toBeInTheDocument();
  },
};

export const Loading: Story = { args: { link: null, loading: true } };

export const SessionExpired: Story = {
  args: { link: null, sessionExpired: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Войти" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Выйти из аккаунта" }),
    ).not.toBeInTheDocument();
  },
};

export const Unavailable: Story = {
  args: { link: null, unavailable: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Состояние аккаунта сейчас недоступно.",
    );
  },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
