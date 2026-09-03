import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import { AccountTelegramLinkPanel } from "./account-telegram-link-panel.client";

const linkRef = "62000000-0000-4000-8000-000000000001";

const meta = {
  args: {
    link: { kind: "unlinked" },
    onClose: fn(),
    onRefresh: () => Promise.resolve(),
  },
  component: AccountTelegramLinkPanel,
  decorators: [
    (Story) => (
      <div className="grid min-h-screen place-items-center bg-foreground/45 p-4">
        <div className="w-full max-w-[30rem] overflow-hidden rounded-[1.75rem] border border-border/70 bg-background text-foreground shadow-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "Compact post-sign-in Telegram-only onboarding panel. Membership state and acquisition actions intentionally stay outside this surface.",
      },
    },
    layout: "fullscreen",
  },
  title: "Patterns/Account access/Telegram onboarding",
} satisfies Meta<typeof AccountTelegramLinkPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unlinked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Подключите Telegram" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Подключить Telegram" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByText(/Доступ|Membership|Получить доступ/u)).not.toBeInTheDocument();
  },
};

export const Linking: Story = {
  args: {
    link: {
      expiresAt: "2030-01-01T00:05:00.000Z",
      kind: "linking",
      linkRef,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Подключаем Telegram")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Проверить связь" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByText(/2030|00:05/iu)).not.toBeInTheDocument();
  },
};

export const Linked: Story = {
  args: { link: { kind: "linked" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Telegram подключён")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Продолжить" }),
    ).toBeInTheDocument();
  },
};

export const Conflict: Story = {
  args: {
    link: { kind: "conflict", supportUrl: "https://t.me/inside_support" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Не получилось подключить")).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Написать в поддержку" }),
    ).toHaveAttribute("href", "https://t.me/inside_support");
  },
};

export const ExpiredAttempt: Story = {
  args: { link: { kind: "retryable", reason: "expired" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Подключите Telegram заново")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Попробовать снова" }),
    ).toBeInTheDocument();
  },
};

export const ConfirmationUnavailable: Story = {
  args: {
    link: {
      kind: "unavailable",
      retry: { kind: "confirm", linkRef },
    },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("button", { name: "Повторить проверку" }),
    ).toBeInTheDocument();
  },
};

export const RefreshUnavailable: Story = {
  args: {
    link: { kind: "unavailable", retry: { kind: "refresh" } },
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("button", { name: "Обновить состояние" }),
    ).toBeInTheDocument();
  },
};

export const RecoveryRequired: Story = {
  args: {
    link: {
      kind: "recovery-required",
      recovery: { kind: "support", url: "https://t.me/inside_support" },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Нужна помощь с подключением")).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Написать в поддержку" }),
    ).toHaveAttribute("href", "https://t.me/inside_support");
  },
};
