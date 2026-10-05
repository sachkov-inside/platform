import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import {
  accountPresentationResponse,
  respondByPath,
} from "@/storybook/account.fixtures";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { publicPageEnvironment } from "@/storybook/story-environment";

import type { AccountTelegramMembership } from "../model/account-telegram-membership";

const linkRef = "62000000-0000-4000-8000-000000000001";

/** Участник только что вошёл: окно ещё не закрывали в этой сессии. */
const environment = publicPageEnvironment("/account", {
  account: "authenticated",
  telegramOnboarding: "shown",
});

const meta = {
  title: "Patterns/Account access/Telegram onboarding",
  render: () => <></>,
  parameters: {
    docs: {
      description: {
        component:
          "Окно подключения Telegram после входа. Его открывает сама публичная оболочка, пока Telegram не подключён и окно не закрыли в этой сессии. Состояние связи приходит из `/api/account`; статус доступа и покупки в окно не входят.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Участник только что вошёл: оболочка читает `/api/account` и сама открывает окно. Ответы идут по
 * очереди, последний повторяется: так видно, как окно меняется, когда человек вернулся из Telegram.
 */
function onboarding(
  ...links: readonly [
    AccountTelegramMembership["link"],
    ...AccountTelegramMembership["link"][],
  ]
): Pick<Story, "beforeEach" | "decorators" | "parameters"> {
  return {
    ...environment,
    beforeEach: [
      environment.beforeEach,
      () => {
        let reads = 0;
        return fetchBeforeRender(
          respondByPath({
            "/api/account": () =>
              accountPresentationResponse({
                link: links[Math.min(reads++, links.length - 1)] ?? links[0],
              }),
          }),
        )();
      },
    ],
  };
}

async function onboardingDialog(canvasElement: HTMLElement) {
  return within(
    await within(canvasElement.ownerDocument.body).findByRole("dialog"),
  );
}

export const Unlinked: Story = {
  ...onboarding({ kind: "unlinked" }),
  play: async ({ canvasElement }) => {
    const dialog = await onboardingDialog(canvasElement);
    await expect(
      dialog.getByRole("heading", { name: "Подключите Telegram" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Подключить Telegram" }),
    ).toBeInTheDocument();
    await expect(
      dialog.queryByText(/Доступ|Membership|Получить доступ/u),
    ).not.toBeInTheDocument();
  },
};

export const UnlinkedMobile: Story = {
  ...Unlinked,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const Linking: Story = {
  ...onboarding({
    expiresAt: "2030-01-01T00:05:00.000Z",
    kind: "linking",
    linkRef,
  }),
  play: async ({ canvasElement }) => {
    const dialog = await onboardingDialog(canvasElement);
    await expect(dialog.getByText("Подключаем Telegram")).toBeInTheDocument();
    await expect(
      dialog.getByRole("button", { name: "Проверить связь" }),
    ).toBeInTheDocument();
    await expect(dialog.queryByText(/2030|00:05/iu)).not.toBeInTheDocument();
  },
};

/**
 * Весь путь подключения на настоящих командах: «Подключить Telegram» открывает бота, а когда
 * человек вернулся во вкладку, окно само подтверждает связь и показывает, что Telegram подключён.
 */
export const Linked: Story = {
  ...environment,
  beforeEach: [
    environment.beforeEach,
    () => {
      let link: AccountTelegramMembership["link"] = { kind: "unlinked" };
      const state = (status: "linked" | "pending") =>
        Response.json({
          kind: "received",
          state: {
            ...(status === "pending"
              ? { deepLink: "https://t.me/inside_test_bot?start=opaque" }
              : {}),
            expiresAt: "2030-01-01T00:05:00.000Z",
            linkRef,
            status,
          },
        });
      return fetchBeforeRender(
        respondByPath({
          "/api/account": () => accountPresentationResponse({ link }),
          "/api/account/telegram-link/begin": () => {
            link = {
              expiresAt: "2030-01-01T00:05:00.000Z",
              kind: "linking",
              linkRef,
            };
            return state("pending");
          },
          "/api/account/telegram-link/confirm": () => {
            link = { kind: "linked" };
            return state("linked");
          },
        }),
      )();
    },
  ],
  play: async ({ canvasElement }) => {
    const dialog = await onboardingDialog(canvasElement);
    const storyWindow = canvasElement.ownerDocument.defaultView;
    if (storyWindow === null) throw new Error("У story нет окна");
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
      await userEvent.click(
        dialog.getByRole("button", { name: "Подключить Telegram" }),
      );
      await waitFor(() =>
        expect(openedTelegram).toHaveBeenCalledWith(
          "https://t.me/inside_test_bot?start=opaque",
        ),
      );
      await expect(
        await dialog.findByText("Подключаем Telegram"),
      ).toBeInTheDocument();
      storyWindow.dispatchEvent(new Event("focus"));
      await expect(
        await dialog.findByText("Telegram подключён"),
      ).toBeInTheDocument();
      await expect(
        dialog.getByRole("button", { name: "Продолжить" }),
      ).toBeInTheDocument();
    } finally {
      Object.defineProperty(storyWindow, "open", {
        configurable: true,
        value: originalOpen,
      });
    }
  },
};

export const Conflict: Story = {
  ...onboarding({
    kind: "conflict",
    supportUrl: "https://t.me/inside_support",
  }),
  play: async ({ canvasElement }) => {
    const dialog = await onboardingDialog(canvasElement);
    await expect(
      dialog.getByText("Не получилось подключить"),
    ).toBeInTheDocument();
    await expect(
      dialog.getByRole("link", { name: "Написать в поддержку" }),
    ).toHaveAttribute("href", "https://t.me/inside_support");
  },
};

export const ExpiredAttempt: Story = {
  ...onboarding({ kind: "retryable", reason: "expired" }),
  play: async ({ canvasElement }) => {
    const dialog = await onboardingDialog(canvasElement);
    await expect(
      dialog.getByText("Подключите Telegram заново"),
    ).toBeInTheDocument();
    await expect(
      dialog.getByRole("button", { name: "Попробовать снова" }),
    ).toBeInTheDocument();
  },
};

export const ConfirmationUnavailable: Story = {
  ...onboarding({ kind: "unavailable", retry: { kind: "confirm", linkRef } }),
  play: async ({ canvasElement }) => {
    const dialog = await onboardingDialog(canvasElement);
    await expect(
      dialog.getByRole("button", { name: "Повторить проверку" }),
    ).toBeInTheDocument();
  },
};

export const RefreshUnavailable: Story = {
  ...onboarding({ kind: "unavailable", retry: { kind: "refresh" } }),
  play: async ({ canvasElement }) => {
    const dialog = await onboardingDialog(canvasElement);
    await expect(
      dialog.getByRole("button", { name: "Обновить состояние" }),
    ).toBeInTheDocument();
  },
};

export const RecoveryRequired: Story = {
  ...onboarding({
    kind: "recovery-required",
    recovery: { kind: "support", url: "https://t.me/inside_support" },
  }),
  play: async ({ canvasElement }) => {
    const dialog = await onboardingDialog(canvasElement);
    await expect(
      dialog.getByText("Нужна помощь с подключением"),
    ).toBeInTheDocument();
    await expect(
      dialog.getByRole("link", { name: "Написать в поддержку" }),
    ).toHaveAttribute("href", "https://t.me/inside_support");
  },
};
