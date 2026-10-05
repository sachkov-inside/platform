import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import {
  notificationPreferencesResponse,
  pendingResponse,
  respondByPath,
  type RouteResponse,
  subscribedMemberRoutes,
  unauthorizedResponse,
} from "@/storybook/account.fixtures";
import {
  accountSectionEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { AccountNotificationsPage } from "./account-notifications-page.client";

const path = "/account/notifications";
const preferencesPath = "/api/account/notifications/preferences";
const changePath = "/api/account/notifications/preferences/change";

const desktop = {
  viewport: { isRotated: false, value: "desktop1440" },
} as const;
const mobile = { viewport: { isRotated: false, value: "mobile390" } } as const;

/**
 * Раздел в кабинете участника с подпиской. `routes` даёт ответы BFF этого раздела и создаётся
 * заново на каждый показ, поэтому сохранённый выбор не переходит в следующую story.
 */
function notificationsPage(
  routes: () => Readonly<Record<string, RouteResponse>>,
): Pick<Story, "beforeEach" | "decorators" | "parameters"> {
  return accountSectionEnvironment(path, {
    fetch: () => respondByPath({ ...subscribedMemberRoutes, ...routes() }),
  });
}

const optedOut = notificationsPage(() => ({
  [preferencesPath]: () => notificationPreferencesResponse(),
}));

const meta = {
  title: "Pages/Account/Notifications",
  component: AccountNotificationsPage,
  parameters: {
    docs: {
      description: {
        component:
          "Раздел «Уведомления» маршрута `/account/notifications`: каналы сообщений о новых материалах. По умолчанию оба канала выключены; чеки и служебные сообщения об оплате приходят на подтверждённый email независимо от этого выбора.",
      },
    },
  },
} satisfies Meta<typeof AccountNotificationsPage>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Оба канала выключены: сохранять нечего, пока выбор не изменился. */
export const OptedOutDesktop: Story = {
  ...optedOut,
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Уведомления" }),
    ).toBeInTheDocument();
    await expect(
      await page.findByRole("checkbox", { name: /Email/u }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: /Telegram/u }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("button", { name: "Сохранить" }),
    ).toBeDisabled();
    await expect(page.getByRole("link", { name: "«Аккаунт»" })).toHaveAttribute(
      "href",
      "/account/access",
    );
  },
};

export const OptedOutMobile: Story = {
  ...optedOut,
  globals: mobile,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("checkbox", { name: /Email/u }),
    ).toBeVisible();
    const root = canvasElement.ownerDocument.documentElement;
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  },
};

/** Выбор сохраняется командой с ожидаемой revision; раздел подтверждает сохранение. */
export const ChangeAndSave: Story = {
  ...notificationsPage(() => {
    let stored = { email: false, telegram: false };
    return {
      [preferencesPath]: () => notificationPreferencesResponse(stored),
      [changePath]: () => {
        stored = { email: true, telegram: false };
        return Response.json({
          ok: true,
          preferences: { revision: 5, ...stored },
        });
      },
    };
  }),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(
      await page.findByRole("checkbox", { name: /Email/u }),
    );
    const save = page.getByRole("button", { name: "Сохранить" });
    await expect(save).toBeEnabled();
    await userEvent.click(save);
    await expect(await page.findByText("Выбор сохранён.")).toHaveAttribute(
      "role",
      "status",
    );
    await expect(page.getByRole("checkbox", { name: /Email/u })).toBeChecked();
  },
};

/** Пока команда идёт, переключатели и кнопка заблокированы. */
export const Saving: Story = {
  ...notificationsPage(() => ({
    [preferencesPath]: () => notificationPreferencesResponse(),
    [changePath]: pendingResponse,
  })),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(
      await page.findByRole("checkbox", { name: /Telegram/u }),
    );
    await userEvent.click(page.getByRole("button", { name: "Сохранить" }));
    await expect(
      await page.findByRole("button", { name: "Сохраняем…" }),
    ).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: /Email/u })).toBeDisabled();
  },
};

/** Настройки изменились в другой вкладке: раздел объясняет это словами и перечитывает их. */
export const SaveConflict: Story = {
  ...notificationsPage(() => ({
    [preferencesPath]: () => notificationPreferencesResponse(),
    [changePath]: () => Response.json({ ok: false, code: "revision_conflict" }),
  })),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(
      await page.findByRole("checkbox", { name: /Email/u }),
    );
    await userEvent.click(page.getByRole("button", { name: "Сохранить" }));
    await expect(await page.findByRole("alert")).toHaveTextContent(
      "Данные изменились. Повторите действие.",
    );
  },
};

export const Loading: Story = {
  ...notificationsPage(() => ({ [preferencesPath]: pendingResponse })),
  globals: desktop,
  play: async ({ canvasElement }) => {
    await expect(
      await routeContent(canvasElement).findByText("Загружаем настройки…"),
    ).toBeInTheDocument();
  },
};

/** Сессия закончилась: раздел зовёт войти снова и возвращает сюда же. */
export const SessionExpired: Story = {
  ...notificationsPage(() => ({ [preferencesPath]: unauthorizedResponse })),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const signIn = await page.findByRole("button", { name: "Войти снова" });
    await expect(signIn.closest("form")).toHaveAttribute(
      "action",
      "/auth/sign-in",
    );
  },
};

export const Unavailable: Story = {
  ...notificationsPage(() => ({
    [preferencesPath]: () =>
      Response.json({ ok: false, code: "unavailable" }, { status: 503 }),
  })),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await waitFor(() =>
      expect(page.getByRole("alert")).toHaveTextContent(
        "Настройки уведомлений сейчас недоступны.",
      ),
    );
  },
};
