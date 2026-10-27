import { expect, it, vi } from "vitest";
import { TelegramUserActivityController } from "../../src/modules/update-inbox/telegram-user-activity.controller.js";
import { loadApplicationConfig } from "../../src/config/application-config.js";
const config = loadApplicationConfig({
  DATABASE_URL: "postgres://fixture@127.0.0.1/unused",
  TELEGRAM_BOT_IDENTITY: "inside",
  TELEGRAM_CANONICAL_CHAT_ID: "-1000000000000",
  TELEGRAM_WEBHOOK_SECRET: "synthetic_webhook_secret_for_tests",
  PLATFORM_INTEGRATION_SECRET: "synthetic_platform_secret_for_tests",
  TELEGRAM_WELCOME_TEXT: "Welcome",
  TELEGRAM_LINK_RECEIPT_TEXT: "Receipt",
  TELEGRAM_LINKED_MEMBER_TEXT: "Member",
  TELEGRAM_LINKED_NON_MEMBER_TEXT: "Nonmember",
  TELEGRAM_LINKED_UNAVAILABLE_TEXT: "Unknown",
  WORKERS_ENABLED: "false",
});
const window = { from: "2026-10-19T00:00:00Z", to: "2026-10-20T00:00:00Z" };
it.each([
  undefined,
  "",
  "Bearer bad",
  "Basic synthetic_platform_secret_for_tests",
])(
  "rejects unauthorized activity reads before parsing or reading facts %#",
  async (authorization) => {
    const read = vi.fn();
    const controller = new TelegramUserActivityController(config, { read });
    await expect(
      controller.read(authorization, { bad: true }),
    ).rejects.toMatchObject({ status: 401 });
    expect(read).not.toHaveBeenCalled();
  },
);
it("admits only the finite runtime contract and strips its version before the owner read", async () => {
  const read = vi
    .fn()
    .mockResolvedValue({ ok: false, error: { code: "source_unavailable" } });
  const controller = new TelegramUserActivityController(config, { read });
  for (const body of [
    { ...window },
    { contractVersion: "wrong", ...window },
    {
      contractVersion: "inside.telegram-activity.v1",
      ...window,
      accountId: "private",
    },
    {
      contractVersion: "inside.telegram-activity.v1",
      from: window.to,
      to: window.from,
    },
  ])
    await expect(
      controller.read(`Bearer ${config.platformIntegrationSecret}`, body),
    ).rejects.toMatchObject({ status: 400 });
  expect(read).not.toHaveBeenCalled();
  await expect(
    controller.read(`Bearer ${config.platformIntegrationSecret}`, {
      contractVersion: "inside.telegram-activity.v1",
      ...window,
    }),
  ).resolves.toEqual({ ok: false, error: { code: "source_unavailable" } });
  expect(read).toHaveBeenCalledExactlyOnceWith(window);
});
