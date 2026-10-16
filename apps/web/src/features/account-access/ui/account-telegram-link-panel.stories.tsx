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

const environment = publicPageEnvironment("/account", {
  account: "authenticated",
});

const meta = {
  title: "Patterns/Account access/Telegram notice",
  render: () => <></>,
  parameters: {
    docs: {
      description: {
        component:
          "Небольшой островок в шапке рядом с аватаркой для вошедшего пользователя без Telegram. Подключение начинается только после нажатия кнопки.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Оболочка читает `/api/account` и показывает островок для неподключённого Telegram. Ответы идут по
 * очереди, последний повторяется: так проверяем возврат из Telegram.
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

async function noticeRegion(canvasElement: HTMLElement) {
  return within(
    await within(canvasElement.ownerDocument.body).findByRole("region", {
      name: "Подключение Telegram",
    }),
  );
}

export const Unlinked: Story = {
  ...onboarding({ kind: "unlinked" }),
  play: async ({ canvasElement }) => {
    const notice = await noticeRegion(canvasElement);
    await expect(
      notice.getByRole("button", { name: /^Подключить Telegram$/u }),
    ).toBeVisible();
    await expect(
      within(canvasElement.ownerDocument.body).queryByRole("dialog"),
    ).not.toBeInTheDocument();
  },
};

export const UnlinkedMobile: Story = {
  ...Unlinked,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

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
    const notice = await noticeRegion(canvasElement);
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
        notice.getByRole("button", { name: /^Подключить Telegram$/u }),
      );
      await waitFor(() =>
        expect(openedTelegram).toHaveBeenCalledWith(
          "https://t.me/inside_test_bot?start=opaque",
        ),
      );
      await expect(
        await notice.findByRole("link", { name: "Открыть Telegram" }),
      ).toBeInTheDocument();
      storyWindow.dispatchEvent(new Event("focus"));
      await waitFor(() =>
        expect(
          within(canvasElement.ownerDocument.body).queryByRole("region", {
            name: "Подключение Telegram",
          }),
        ).not.toBeInTheDocument(),
      );
    } finally {
      Object.defineProperty(storyWindow, "open", {
        configurable: true,
        value: originalOpen,
      });
    }
  },
};

export const AlreadyLinked: Story = {
  ...onboarding({ kind: "linked" }),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement.ownerDocument.body).findAllByRole("button", {
        name: "Аккаунт",
      }),
    ).not.toHaveLength(0);
    await expect(
      within(canvasElement.ownerDocument.body).queryByRole("region", {
        name: "Подключение Telegram",
      }),
    ).not.toBeInTheDocument();
  },
};

export const ExpiredAttempt: Story = {
  ...Unlinked,
  ...onboarding({ kind: "retryable", reason: "expired" }),
};
