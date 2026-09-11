import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { useState } from "react";

import { withMutationFetch } from "@/workshop/mutation-mock";

import type { AccountTelegramMembership } from "../model/account-telegram-membership";
import { AccountTelegramPanel } from "./account-telegram-panel.client";
import { accountSectionEnvironment } from "@/workshop/story-environment";

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
          "Раздел «Аккаунт» отвечает только за связь с Telegram. Что открыто и до какого срока объясняет раздел «Покупки».",
      },
    },
  },
  title: "Pages/Account/Telegram connection",
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
  args: { link: { kind: "conflict", supportUrl: "https://t.me/inside_support" } },
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

let journeyConfirmAttempts = 0;

export const LinkJourney: Story = {
  decorators: [
    withMutationFetch((input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const status = url.endsWith("/begin")
        ? "pending"
        : journeyConfirmAttempts++ === 0
          ? "unavailable"
          : "linked";
      return Promise.resolve(
        Response.json({
          kind: "received",
          state: {
            ...(status === "pending"
              ? { deepLink: "https://t.me/inside_test_bot?start=opaque" }
              : {}),
            expiresAt: "2030-01-01T00:05:00.000Z",
            linkRef: journeyLinkRef,
            status,
          },
        }),
      );
    }),
  ],
  name: "Begin → automatic confirm outage → retry → linked",
  play: async ({ canvasElement }) => {
    journeyConfirmAttempts = 0;
    const canvas = within(canvasElement);
    const storyWindow = canvasElement.ownerDocument.defaultView;
    if (storyWindow === null) throw new Error("Story window is unavailable");
    const originalOpen = storyWindow.open;
    const openedTelegram = fn();
    Object.defineProperty(storyWindow, "open", {
      configurable: true,
      value: () => ({
        close: () => undefined,
        location: { replace: openedTelegram },
        opener: null,
      }),
    });
    try {
      await userEvent.click(canvas.getByRole("button", { name: "Подключить" }));
      await expect(openedTelegram).toHaveBeenCalledWith(
        "https://t.me/inside_test_bot?start=opaque",
      );
      storyWindow.dispatchEvent(new Event("focus"));
      await userEvent.click(
        await canvas.findByRole("button", { name: "Повторить проверку" }),
      );
      await expect(
        await canvas.findByText("Telegram подключён"),
      ).toBeInTheDocument();
    } finally {
      Object.defineProperty(storyWindow, "open", {
        configurable: true,
        value: originalOpen,
      });
    }
  },
  render: () => <TelegramLinkJourney />,
};

function TelegramLinkJourney() {
  const [link, setLink] = useState<AccountTelegramMembership["link"]>({
    kind: "unlinked",
  });
  return (
    <AccountTelegramPanel
      link={link}
      onRefresh={() => {
        setLink((current) => {
          switch (current.kind) {
            case "unlinked":
              return {
                expiresAt: "2030-01-01T00:05:00.000Z",
                kind: "linking",
                linkRef: journeyLinkRef,
              };
            case "linking":
              return {
                kind: "unavailable",
                retry: { kind: "confirm", linkRef: journeyLinkRef },
              };
            case "unavailable":
              return { kind: "linked" };
            case "conflict":
            case "linked":
            case "recovery-required":
            case "retryable":
              return current;
          }
        });
        return Promise.resolve();
      }}
    />
  );
}

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
};
