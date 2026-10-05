import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { AccountTelegramPanel } from "./account-telegram-panel.client";
import { accountSectionEnvironment } from "@/storybook/story-environment";

const journeyLinkRef = "62000000-0000-4000-8000-000000000001";

const environment = accountSectionEnvironment("/account/access");

const meta = {
  ...environment,
  args: {
    link: { kind: "linked" },
    onRefresh: () => Promise.resolve(),
  },
  component: AccountTelegramPanel,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Блок связи с Telegram в разделе «Аккаунт». Он отвечает только за связь; что открыто и до какого срока, объясняет раздел «Покупки». Весь раздел показывает «Pages/Account/Access».",
      },
    },
  },
  title: "Components/Account/Telegram connection",
} satisfies Meta<typeof AccountTelegramPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Linked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Telegram подключён")).toBeInTheDocument();
    // Продающий блок здесь не живёт: это задача витрины и раздела «Покупки».
    await expect(
      canvas.queryByRole("link", { name: "Получить доступ" }),
    ).not.toBeInTheDocument();
  },
};

export const Unlinked: Story = {
  args: { link: { kind: "unlinked" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Telegram не подключён")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Подключить" }),
    ).toBeInTheDocument();
  },
};

export const Linking: Story = {
  args: {
    link: {
      expiresAt: "2030-01-01T00:05:00.000Z",
      kind: "linking",
      linkRef: journeyLinkRef,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Подключаем Telegram")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Проверить подключение" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByText(/2030|00:05/iu)).not.toBeInTheDocument();
  },
};

export const LinkConflict: Story = {
  args: {
    link: { kind: "conflict", supportUrl: "https://t.me/inside_support" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Обнаружен конфликт")).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Написать в поддержку" }),
    ).toHaveAttribute("href", "https://t.me/inside_support");
  },
};

export const ExpiredAttempt: Story = {
  args: { link: { kind: "retryable", reason: "expired" } },
  name: "Expired attempt · safe restart",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Срок попытки истёк")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Попробовать снова" }),
    ).toBeInTheDocument();
  },
};

export const Unavailable: Story = {
  args: {
    link: {
      kind: "unavailable",
      retry: { kind: "confirm", linkRef: journeyLinkRef },
    },
  },
};

export const RecoveryRequired: Story = {
  args: {
    link: {
      kind: "recovery-required",
      recovery: { kind: "support", url: "https://t.me/inside_support" },
    },
  },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
