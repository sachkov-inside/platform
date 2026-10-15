import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import {
  accountPresentationResponse,
  respondByPath,
} from "@/storybook/account.fixtures";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { getQueryClient } from "@/shared/api/query-client";
import { publicPageEnvironment } from "@/storybook/story-environment";
import type { AccountTelegramMembership } from "@/features/account-access";
import { TelegramContinuationPage } from "./telegram-continuation-page.client";

const attemptId = "62000000-0000-4000-8000-000000000001";
const product = {
  id: "62000000-0000-4000-8000-000000000002",
  slug: "ai-engineering",
  name: "AI Engineering",
};
const environment = publicPageEnvironment("/telegram/continue", {
  account: "authenticated",
});
const meta = {
  ...environment,
  title: "Pages/Telegram activation",
  component: TelegramContinuationPage,
  args: { attemptId },
} satisfies Meta<typeof TelegramContinuationPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FirstLink: Story = {
  beforeEach: [
    () => {
      getQueryClient().clear();
      return environment.beforeEach();
    },
    () => {
      let link: AccountTelegramMembership["link"] = { kind: "unlinked" };
      let confirmed = false;
      return fetchBeforeRender(
        respondByPath({
          "/api/account": () => accountPresentationResponse({ link }),
          [`/api/account/telegram-activation/${attemptId}`]: () =>
            Response.json({
              state: confirmed ? "active" : "link_required",
              product,
            }),
          "/api/account/telegram-link/begin": () => {
            link = {
              kind: "linking",
              linkRef: attemptId,
              expiresAt: "2099-01-01T00:00:00.000Z",
            };
            return Response.json({
              kind: "received",
              state: {
                status: "pending",
                linkRef: attemptId,
                expiresAt: "2099-01-01T00:00:00.000Z",
                deepLink: "https://t.me/inside_test_bot?start=opaque",
              },
            });
          },
          "/api/account/telegram-link/confirm": () => {
            confirmed = true;
            link = { kind: "linked" };
            return Response.json({
              kind: "received",
              state: {
                status: "linked",
                linkRef: attemptId,
                expiresAt: "2099-01-01T00:00:00.000Z",
              },
            });
          },
        }),
      )();
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const storyWindow = canvasElement.ownerDocument.defaultView;
    if (storyWindow === null) throw new Error("Story window missing");
    const originalOpen = storyWindow.open;
    const opened = fn();
    Object.defineProperty(storyWindow, "open", {
      configurable: true,
      value: () => ({
        opener: null,
        close: fn(),
        location: { replace: opened },
      }),
    });
    try {
      await expect(
        await canvas.findByRole("heading", { name: "AI Engineering" }),
      ).toBeVisible();
      await userEvent.click(
        await canvas.findByRole("button", { name: "Подключить" }),
      );
      await waitFor(() =>
        expect(opened).toHaveBeenCalledWith(
          "https://t.me/inside_test_bot?start=opaque",
        ),
      );
      storyWindow.dispatchEvent(new Event("focus"));
      await expect(
        await canvas.findByText("Курс доступен. Открываем программу…"),
      ).toBeVisible();
    } finally {
      Object.defineProperty(storyWindow, "open", {
        configurable: true,
        value: originalOpen,
      });
    }
  },
};
export const FirstLinkMobile: Story = {
  ...FirstLink,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const SignIn: Story = {
  beforeEach: [
    () => {
      getQueryClient().clear();
      return environment.beforeEach();
    },
    () =>
      fetchBeforeRender(
        respondByPath({
          "/api/account": () => new Response(null, { status: 401 }),
          [`/api/account/telegram-activation/${attemptId}`]: () =>
            new Response(null, { status: 401 }),
        }),
      )(),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = await canvas.findByRole("button", {
      name: "Войти через Telegram или почту",
    });
    await expect(
      button.closest("form")?.querySelector("input[name=returnTo]"),
    ).toHaveValue(`/telegram/continue?attempt=${attemptId}`);
  },
};
export const Conflict: Story = {
  beforeEach: [
    () => {
      getQueryClient().clear();
      return environment.beforeEach();
    },
    () =>
      fetchBeforeRender(
        respondByPath({
          "/api/account": () => accountPresentationResponse(),
          [`/api/account/telegram-activation/${attemptId}`]: () =>
            Response.json({ state: "identity_conflict" }),
        }),
      )(),
  ],
};
export const Expired: Story = {
  beforeEach: [
    () => {
      getQueryClient().clear();
      return environment.beforeEach();
    },
    () =>
      fetchBeforeRender(
        respondByPath({
          "/api/account": () => accountPresentationResponse(),
          [`/api/account/telegram-activation/${attemptId}`]: () =>
            Response.json({ state: "expired" }),
        }),
      )(),
  ],
};
