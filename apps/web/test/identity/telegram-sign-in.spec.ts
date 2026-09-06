import { mkdir } from "node:fs/promises";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { z } from "zod";

if (!process.env.WEB_BASE_URL || !process.env.LOGTO_ENDPOINT)
  throw new Error(
    "Explicit isolated WEB_BASE_URL and LOGTO_ENDPOINT are required",
  );

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
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page.getByRole("link", { name: "Профиль", exact: true }).click();
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
  userId = telegramUserId,
) {
  const from = { id: userId, is_bot: false, first_name: "Synthetic" };
  const chat = { id: userId, type: "private" };
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
  await mkdir("../../docs/evidence/issue-299", { recursive: true });
  await page.screenshot({
    path: "../../docs/evidence/issue-299/telegram-waiting-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "../../docs/evidence/issue-299/telegram-waiting-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1024 });
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
  const before = await createProfile(page);
  // The isolated proof resource uses a 60-second access-token lifetime.
  await page.waitForTimeout(61_000);
  const refreshed = await page.request.get("/auth/status");
  expect(
    z.object({ state: z.string() }).parse(await refreshed.json()).state,
  ).toBe("authenticated");
  expect(await profileId(page)).toBe(before);
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
  expect(await profileId(page)).toBe(before);
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

const profileSchema = z.object({
  state: z.object({
    kind: z.literal("profile"),
    profile: z.object({ publicProfileId: z.string(), displayName: z.string() }),
  }),
});
async function profileId(page: Page) {
  return profileSchema.parse(
    await (await page.request.get("/api/account/profile")).json(),
  ).state.profile.publicProfileId;
}
async function createProfile(page: Page) {
  const response = await page.request.post("/api/account/profile", {
    headers: { origin: new URL(page.url()).origin },
    form: { displayName: "Synthetic identity proof", bio: "" },
  });
  expect(response.ok()).toBeTruthy();
  return profileId(page);
}

test("email Account explicitly links Telegram and bot sign-in retains its private profile", async ({
  page,
  request,
}) => {
  const userId = 29910000 + (Date.now() % 1_000_000);
  const email = `telegram-${String(userId)}@example.test`;
  await page.goto("/");
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page.getByRole("link", { name: "Профиль", exact: true }).click();
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('button[type="submit"]').click();
  const messagesSchema = z.object({
    messages: z.array(
      z.object({
        Snippet: z.string(),
        To: z.array(z.object({ Address: z.string() })),
      }),
    ),
  });
  let code = "";
  await expect
    .poll(async () => {
      const response = await request.get(
        "http://127.0.0.1:3625/api/v1/messages",
      );
      const message = messagesSchema
        .parse(await response.json())
        .messages.find((candidate) =>
          candidate.To.some((recipient) => recipient.Address === email),
        );
      code = /\b(\d{6})\b/u.exec(message?.Snippet ?? "")?.[1] ?? "";
      return code.length;
    })
    .toBe(6);
  const inputs = page.locator(
    'input[inputmode="numeric"], input[autocomplete="one-time-code"]',
  );
  await expect(inputs.first()).toBeVisible();
  if ((await inputs.count()) === 1) await inputs.fill(code);
  else
    for (let index = 0; index < 6; index++)
      await inputs.nth(index).fill(code.charAt(index));
  const submit = page.locator('button[type="submit"]');
  if (await submit.isVisible()) await submit.click();
  await expect(
    page.getByRole("button", { name: "Выйти", exact: true }),
  ).toBeVisible();
  const before = await createProfile(page);
  const origin = new URL(page.url()).origin;
  const response = await page.request.post("/api/account/telegram-link/begin", {
    headers: { origin },
    form: {},
  });
  const link = z
    .object({
      kind: z.literal("received"),
      state: z.object({ deepLink: z.url(), linkRef: z.uuid() }),
    })
    .parse(await response.json()).state;
  const token = z
    .string()
    .min(1)
    .parse(new URL(link.deepLink).searchParams.get("start"));
  expect(
    (
      await request.post(webhookEndpoint, {
        headers: { "x-telegram-bot-api-secret-token": webhookSecret },
        data: {
          update_id: Date.now() % 1_000_000_000,
          message: {
            message_id: 1,
            date: Math.floor(Date.now() / 1000),
            from: { id: userId, is_bot: false, first_name: "Synthetic" },
            chat: { id: userId, type: "private" },
            text: `/start ${token}`,
          },
        },
      })
    ).ok(),
  ).toBeTruthy();
  await expect
    .poll(async () => {
      const confirmation = await page.request.post(
        "/api/account/telegram-link/confirm",
        { headers: { origin }, form: { linkRef: link.linkRef } },
      );
      return z
        .object({ state: z.object({ status: z.string() }) })
        .parse(await confirmation.json()).state.status;
    })
    .toBe("linked");
  // The onboarding dialog may cover the header; navigate to the account before logging out.
  await page.goto("/account");
  const dismiss = page.getByRole("button", { name: "Позже", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Войти", exact: true }),
  ).toBeVisible();
  await confirm(page, request, await start(page), "approve", userId);
  await expect(
    page.getByRole("button", { name: "Выйти", exact: true }),
  ).toBeVisible();
  expect(await profileId(page)).toBe(before);
});

test("two fresh Logto interactions for one Telegram identity converge on one Account", async ({
  page,
  request,
  browser,
}) => {
  const otherContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: process.env.WEB_BASE_URL,
  });
  const other = await otherContext.newPage();
  const userId = 39910000 + (Date.now() % 1_000_000);
  try {
    const [first, second] = await Promise.all([start(page), start(other)]);
    await Promise.all([
      confirm(page, request, first, "approve", userId),
      confirm(other, request, second, "approve", userId),
    ]);
    const authenticated = async (candidate: Page) => {
      const response = await candidate.request.get(
        `${process.env.WEB_BASE_URL ?? ""}/auth/status`,
      );
      return (
        z.object({ state: z.string() }).parse(await response.json()).state ===
        "authenticated"
      );
    };
    await expect
      .poll(async () =>
        (await Promise.all([authenticated(page), authenticated(other)])).some(
          Boolean,
        ),
      )
      .toBe(true);
    const winner = (await authenticated(page)) ? page : other;
    const secondPage = winner === page ? other : page;
    const identity = await createProfile(winner);
    if (!(await authenticated(secondPage))) {
      await secondPage.context().clearCookies();
      await confirm(
        secondPage,
        request,
        await start(secondPage),
        "approve",
        userId,
      );
      await expect(
        secondPage.getByRole("button", { name: "Выйти", exact: true }),
      ).toBeVisible();
    }
    expect(await profileId(secondPage)).toBe(identity);
  } finally {
    await otherContext.close();
  }
});

for (const [status, copy] of [
  ["expired", "Время вышло"],
  ["disabled", "отключён"],
  ["unavailable", "недоступен"],
] as const) {
  test(`waiting presentation handles ${status} on mobile`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await start(page);
    // Presentation-only fixture; actual expiry/disable semantics are tested in the provider and verifier.
    await page.route("**/api/inside-telegram/status", (route) =>
      route.fulfill({ json: { status } }),
    );
    await expect(page.getByRole("status")).toContainText(copy);
    await expect(page.locator("#bot")).toBeHidden();
    await expect(page.getByRole("link", { name: "Через почту" })).toBeVisible();
    await page.screenshot({
      path: `../../docs/evidence/issue-299/telegram-${status}-mobile.png`,
      fullPage: true,
    });
  });
}
