import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const backendPort = process.env["FAKE_BACKEND_PORT"];
if (backendPort === undefined) throw new Error("FAKE_BACKEND_PORT is required");
const backend = `http://127.0.0.1:${backendPort}`;
const fixture = `${backend}/__account-access`;
const token = "account-access-lifetimes-first";
const linkRef = "62000000-0000-4000-8000-000000000011";
const attemptId = "62000000-0000-4000-8000-000000000021";
const bot = "https://t.me/inside_test_bot?start=account_lifetime";

async function signIn(
  context: BrowserContext,
  baseURL: string | undefined,
  account = token,
) {
  if (baseURL === undefined) throw new Error("baseURL is required");
  const { wrapSession } = await import("@logto/node");
  const session = await wrapSession(
    {
      accessToken: JSON.stringify({
        [`@${backend}`]: {
          // deterministic-test-allow wall-clock: the real Logto SDK checks the synthetic cookie against this machine's clock.
          expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
          scope: "",
          token: account,
        },
      }),
      idToken: "fixture.id.token",
      refreshToken: "account-access-navigation-refresh",
    },
    "inside-navigation-logto-cookie-secret-key",
  );
  await context.addCookies([
    {
      url: baseURL,
      name: "logto_inside-web-navigation",
      value: session,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await context.route(bot, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<h1>Тестовый бот Telegram</h1>",
    }),
  );
}

function telegram(page: Page) {
  return page.getByRole("region", { name: "Telegram", exact: true });
}

async function showHome(page: Page) {
  await page
    .getByRole("link", { name: /^sachkov\.dev(?:, Главная)?$/u })
    .click();
  await expect(page).toHaveURL(/\/$/u);
  const retainedAccount = page
    .locator("h1")
    .filter({ hasText: /^Личный кабинет$/u });
  await expect(retainedAccount).toHaveCount(1);
  await expect(retainedAccount).toBeHidden();
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${fixture}?action=reset`)).ok()).toBe(true);
});

test("account disclosure follows the initial hash and hash changes while allowing manual closing", async ({
  baseURL,
  context,
  page,
}) => {
  await signIn(context, baseURL);
  await page.goto("/account#documents");
  const documents = page.getByRole("button", { name: /^Документы/u });
  await expect(documents).toHaveAttribute("aria-expanded", "true");
  await documents.click();
  await expect(documents).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => {
    location.hash = "other";
  });
  await expect(page).toHaveURL(/#other$/u);
  await expect(documents).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => {
    location.hash = "documents";
  });
  await expect(documents).toHaveAttribute("aria-expanded", "true");
  await page.evaluate(() => {
    location.hash = "other";
  });
  await expect(page).toHaveURL(/#other$/u);
  await expect(documents).toHaveAttribute("aria-expanded", "true");
});

test("returning from the Telegram window confirms one current Account payload and keeps pending retry", async ({
  baseURL,
  context,
  page,
  request,
}) => {
  await signIn(context, baseURL);
  await page.goto("/account");
  const section = telegram(page);
  const popupReady = context.waitForEvent("page");
  await section
    .getByRole("button", { name: "Подключить", exact: true })
    .click();
  const popup = await popupReady;
  await expect(
    popup.getByRole("heading", { name: "Тестовый бот Telegram" }),
  ).toBeVisible();
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await expect(section.getByText("Проверяем подключение…")).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });

  expect((await request.post(`${fixture}?action=hold-confirm`)).ok()).toBe(
    true,
  );
  const confirmation = page.waitForRequest((entry) =>
    entry.url().endsWith("/api/account/telegram-link/confirm"),
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });
  expect((await confirmation).postDataJSON()).toEqual({ linkRef });
  expect((await request.post(`${fixture}?action=release-confirm`)).ok()).toBe(
    true,
  );
  await expect(
    section.getByRole("button", { name: "Проверить подключение" }),
  ).toBeEnabled();
  expect(await (await request.get(fixture)).json()).toEqual([
    { account: `Bearer ${token}`, linkRef },
  ]);
  await expect(
    section.getByRole("link", { name: "Открыть Telegram" }),
  ).toHaveAttribute("href", bot);

  if (baseURL === undefined) throw new Error("baseURL is required");
  const other = await context.browser()?.newContext({ baseURL });
  if (other === undefined) throw new Error("browser is required");
  try {
    await signIn(other, baseURL, "account-access-lifetimes-second");
    const second = await other.newPage();
    await second.goto("/account");
    await expect(
      telegram(second).getByText("Telegram не подключён"),
    ).toBeVisible();
  } finally {
    await other.close();
  }

  await showHome(page);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.goBack();
  await expect(
    section.getByRole("link", { name: "Открыть Telegram" }),
  ).toBeVisible();
  expect(await (await request.get(fixture)).json()).toEqual([
    { account: `Bearer ${token}`, linkRef },
  ]);

  expect((await request.post(`${fixture}?action=linked`)).ok()).toBe(true);
  await section.getByRole("button", { name: "Проверить подключение" }).click();
  await expect(section.getByText("Telegram подключён")).toBeVisible();
  expect(await (await request.get(fixture)).json()).toEqual([
    { account: `Bearer ${token}`, linkRef },
    { account: `Bearer ${token}`, linkRef },
  ]);
});

test("leaving the Account before Telegram begin settles closes its blank popup", async ({
  baseURL,
  context,
  page,
  request,
}) => {
  await signIn(context, baseURL);
  await page.goto("/account");
  expect((await request.post(`${fixture}?action=hold-begin`)).ok()).toBe(true);
  const popupReady = context.waitForEvent("page");
  const result = page.waitForResponse((entry) =>
    entry.url().endsWith("/api/account/telegram-link/begin"),
  );
  await telegram(page)
    .getByRole("button", { name: "Подключить", exact: true })
    .click();
  const popup = await popupReady;
  await expect(popup).toHaveURL("about:blank");
  await showHome(page);
  await page.goBack();
  const section = telegram(page);
  await expect(
    section.getByRole("heading", { name: "Telegram" }),
  ).toBeVisible();
  expect((await request.post(`${fixture}?action=release-begin`)).ok()).toBe(
    true,
  );
  expect((await result).ok()).toBe(true);
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(
    section.getByRole("button", { name: "Проверить подключение" }),
  ).toBeEnabled();
  await expect(
    section.getByRole("link", { name: "Открыть Telegram" }),
  ).toHaveCount(0);
});

test("a pending Telegram continuation polls and replaces its address with the active programme", async ({
  baseURL,
  context,
  page,
  request,
}) => {
  await signIn(context, baseURL);
  // Run the browser's actual interval under controlled time.
  await page.clock.install();
  const path = `/telegram/continue?attempt=${attemptId}`;
  await page.goto(path);
  await expect(
    page.getByText("Проверяем доступ к выбранному курсу…"),
  ).toBeVisible();
  expect((await request.post(`${fixture}?action=active`)).ok()).toBe(true);
  await page.clock.runFor(1000);
  await expect(page).toHaveURL(/\/products\/navigation-proof\/programme$/u);
  await expect(
    page.getByRole("heading", { name: /Проверочный продукт/u }).first(),
  ).toBeVisible();
});
