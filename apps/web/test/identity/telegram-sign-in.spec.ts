import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { z } from "zod";

const statusSchema = z.object({
  status: z.string(),
  requestRef: z.uuid().optional(),
});
const logtoEndpoint =
  process.env.LOGTO_ENDPOINT ?? "https://identity.inside.localhost:3631";
const webhookEndpoint =
  process.env.TELEGRAM_PROOF_WEBHOOK_URL ??
  "http://127.0.0.1:3606/webhooks/telegram";
const webhookSecret =
  process.env.TELEGRAM_PROOF_WEBHOOK_SECRET ?? "inside-299-synthetic-webhook";
const telegramUserId = 29900001;

async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByRole("button", { name: /Telegram/u }).click();
  await expect(page.locator("#bot")).toBeVisible();
  const link = z.url().parse(await page.locator("#bot").getAttribute("href"));
  const token = z
    .string()
    .startsWith("signin_")
    .parse(new URL(link).searchParams.get("start"));
  const response = await page.request.get(
    `${logtoEndpoint}/api/inside-telegram/status`,
  );
  const state = statusSchema.parse(await response.json());
  expect(state.status).toBe("pending");
  return { token, requestRef: z.uuid().parse(state.requestRef) };
}

async function confirm(
  page: Page,
  request: APIRequestContext,
  challenge: { token: string; requestRef: string },
  action: "approve" | "deny",
) {
  const from = { id: telegramUserId, is_bot: false, first_name: "Synthetic" };
  const chat = { id: telegramUserId, type: "private" };
  const send = async (data: unknown) => {
    const response = await request.post(webhookEndpoint, {
      headers: { "x-telegram-bot-api-secret-token": webhookSecret },
      data,
    });
    expect(response.ok()).toBeTruthy();
  };
  await send({
    update_id: Date.now() % 1_000_000_000,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      from,
      chat,
      text: `/start ${challenge.token}`,
    },
  });
  // Only synthetic webhook updates enter the real provider inbox; outgoing delivery is disabled.
  await expect
    .poll(
      async () => {
        await send({
          update_id: (Date.now() + 1) % 1_000_000_000,
          callback_query: {
            id: "synthetic-299",
            from,
            chat_instance: "synthetic",
            message: {
              message_id: 2,
              date: Math.floor(Date.now() / 1000),
              chat,
            },
            data: `signin:${action}:${challenge.requestRef}`,
          },
        });
        const response = await page.request.get(
          `${logtoEndpoint}/api/inside-telegram/status`,
        );
        return statusSchema.parse(await response.json()).status;
      },
      { timeout: 30_000 },
    )
    .toMatch(action === "approve" ? /approved|consumed/u : /denied/u);
}

test.beforeEach(async ({ request }) => {
  await expect
    .poll(
      async () => {
        try {
          return (
            await request.get(
              `${logtoEndpoint}/oidc/.well-known/openid-configuration`,
            )
          ).status();
        } catch {
          return 0;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(200);
});

test("Telegram sign-in, logout and fresh repeat use the real Logto session", async ({
  page,
  request,
  browser,
}) => {
  const challenge = await start(page);
  const foreign = await browser.newContext({ ignoreHTTPSErrors: true });
  const response = await foreign.request.get(
    `${logtoEndpoint}/api/inside-telegram/status`,
  );
  expect(statusSchema.parse(await response.json()).status).toBe("unavailable");
  await foreign.close();
  await confirm(page, request, challenge, "approve");
  await expect(
    page.getByRole("button", { name: "Выйти", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Выйти", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Войти", exact: true }),
  ).toBeVisible();
  const repeat = await start(page);
  expect(repeat.requestRef).not.toBe(challenge.requestRef);
  await confirm(page, request, repeat, "approve");
  await expect(
    page.getByRole("button", { name: "Выйти", exact: true }),
  ).toBeVisible();
});

test("declined Telegram confirmation remains signed out and offers email", async ({
  page,
  request,
}) => {
  const challenge = await start(page);
  await confirm(page, request, challenge, "deny");
  await expect(page.getByRole("status")).toContainText("отклонили");
  await expect(page.locator("#bot")).toBeHidden();
  await expect(page.getByRole("link", { name: "Через почту" })).toBeVisible();
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Войти", exact: true }),
  ).toBeVisible();
});
