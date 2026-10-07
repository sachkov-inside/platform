import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { respondByPath } from "@/storybook/account.fixtures";
import { accountSectionEnvironment } from "@/storybook/story-environment";

import { TelegramLinkAction } from "./telegram-link-action.client";

const environment = accountSectionEnvironment("/account/purchases");
const linkRef = "62000000-0000-4000-8000-000000000001";
const deepLink = "https://t.me/inside_test_bot?start=opaque";

const meta = {
  ...environment,
  title: "Features/Account access/Telegram link action",
  component: TelegramLinkAction,
  args: { onRefresh: () => Promise.resolve() },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Одна кнопка подключения Telegram в блоке сообщества: открывает бота с кодом привязки. Привязку завершает сервер, ссылку в группу бот присылает сам.",
      },
    },
  },
} satisfies Meta<typeof TelegramLinkAction>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Раздел «Покупки», где `begin` отвечает новой ссылкой или прежней, чей код сайт не хранит. */
function beginAnswers(withDeepLink: boolean) {
  return accountSectionEnvironment("/account/purchases", {
    fetch: () =>
      respondByPath({
        "/api/account/telegram-link/begin": () =>
          Response.json({
            kind: "received",
            state: {
              ...(withDeepLink ? { deepLink } : {}),
              expiresAt: "2030-01-01T00:05:00.000Z",
              linkRef,
              status: "pending",
            },
          }),
      }),
  }).beforeEach;
}

/** Подменяет `window.open` на время сценария, чтобы story не открывала настоящий Telegram. */
async function withTelegramWindow(
  canvasElement: HTMLElement,
  run: (opened: ReturnType<typeof fn>) => Promise<void>,
): Promise<void> {
  const storyWindow = canvasElement.ownerDocument.defaultView;
  if (storyWindow === null) throw new Error("У story нет окна");
  const originalOpen = storyWindow.open;
  const opened = fn();
  Object.defineProperty(storyWindow, "open", {
    configurable: true,
    value: () => ({
      close: () => undefined,
      location: { replace: opened },
      opener: null,
    }),
  });
  try {
    await run(opened);
  } finally {
    Object.defineProperty(storyWindow, "open", {
      configurable: true,
      value: originalOpen,
    });
  }
}

export const OpensBot: Story = {
  beforeEach: beginAnswers(true),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await withTelegramWindow(canvasElement, async (opened) => {
      await userEvent.click(
        canvas.getByRole("button", { name: "Подключить Telegram" }),
      );
      await waitFor(() => expect(opened).toHaveBeenCalledWith(deepLink));
      await expect(await canvas.findByRole("status")).toHaveTextContent(
        "сам пришлёт личную ссылку в группу",
      );
      await expect(
        canvas.getByRole("link", { name: "Открыть Telegram" }),
      ).toHaveAttribute("href", deepLink);
    });
  },
};

/** Прежняя ссылка ещё действует, а её код сайт не хранит: подключение продолжается в «Доступе». */
export const PreviousLinkStillOpen: Story = {
  beforeEach: beginAnswers(false),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await withTelegramWindow(canvasElement, async () => {
      await userEvent.click(
        canvas.getByRole("button", { name: "Подключить Telegram" }),
      );
      await expect(
        await canvas.findByRole("link", {
          name: "Подключить в разделе «Доступ»",
        }),
      ).toHaveAttribute("href", "/account/access");
    });
  },
};
