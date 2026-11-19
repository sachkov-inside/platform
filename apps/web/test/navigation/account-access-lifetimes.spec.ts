import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

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

const confirmed = { account: `Bearer ${token}`, linkRef };

async function control(request: APIRequestContext, action: string) {
  expect((await request.post(`${fixture}?action=${action}`)).ok()).toBe(true);
}

async function entered(request: APIRequestContext, phase: "begin" | "confirm") {
  const response = await request.get(`${fixture}?checkpoint=${phase}`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<unknown>;
}

async function browserTurn(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          channel.port2.close();
          resolve();
        };
        channel.port2.postMessage(null);
      }),
  );
}

/** Deliver a specific native event to the real application, with controlled tab visibility. */
async function returnEvents(
  page: Page,
  visibility: "visible" | "hidden",
  events: readonly ("focus" | "visibilitychange")[],
) {
  await page.evaluate(
    ({ events, visibility }) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: visibility,
      });
      try {
        for (const type of events) {
          const target = type === "focus" ? window : document;
          target.dispatchEvent(new Event(type));
        }
      } finally {
        Reflect.deleteProperty(document, "visibilityState");
      }
    },
    { events, visibility },
  );
  await browserTurn(page);
}

async function beginTelegram(page: Page, context: BrowserContext) {
  const popupReady = context.waitForEvent("page");
  await telegram(page)
    .getByRole("button", { name: "Подключить", exact: true })
    .click();
  const popup = await popupReady;
  await expect(
    popup.getByRole("heading", { name: "Тестовый бот Telegram" }),
  ).toBeVisible();
  await expect(
    telegram(page).getByText("Проверяем подключение…"),
  ).toBeVisible();
  return popup;
}

test.beforeEach(async ({ request }) => {
  await control(request, "reset");
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
  const popup = await beginTelegram(page, context);
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);

  const browserConfirmations: string[] = [];
  page.on("request", (entry) => {
    if (entry.url().endsWith("/api/account/telegram-link/confirm"))
      browserConfirmations.push(entry.url());
  });
  await returnEvents(page, "hidden", ["visibilitychange", "focus"]);
  expect(browserConfirmations).toHaveLength(0);

  const returnSignals = ["focus", "visibilitychange"] as const;
  for (const [index, returnedBy] of returnSignals.entries()) {
    await control(request, "hold-confirm");
    const confirmation = page.waitForRequest((entry) =>
      entry.url().endsWith("/api/account/telegram-link/confirm"),
    );
    await returnEvents(page, "visible", [returnedBy]);
    expect((await confirmation).postDataJSON()).toEqual({ linkRef });
    expect(await entered(request, "confirm")).toEqual(
      Array(index + 1).fill(confirmed),
    );
    await returnEvents(page, "visible", [
      "visibilitychange",
      "focus",
      "visibilitychange",
    ]);
    expect(browserConfirmations).toHaveLength(index + 1);
    await control(request, "release-confirm");
    await expect(
      section.getByRole("button", { name: "Проверить подключение" }),
    ).toBeEnabled();
  }

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
  await returnEvents(page, "visible", ["focus", "visibilitychange"]);
  expect(browserConfirmations).toHaveLength(2);
  await page.goBack();
  await expect(
    section.getByRole("link", { name: "Открыть Telegram" }),
  ).toBeVisible();
  expect(await (await request.get(fixture)).json()).toEqual([
    confirmed,
    confirmed,
  ]);

  await control(request, "linked");
  await section.getByRole("button", { name: "Проверить подключение" }).click();
  await expect(section.getByText("Telegram подключён")).toBeVisible();
  expect(await (await request.get(fixture)).json()).toEqual([
    confirmed,
    confirmed,
    confirmed,
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
  await control(request, "hold-begin");
  const popupReady = context.waitForEvent("page");
  const result = page.waitForResponse((entry) =>
    entry.url().endsWith("/api/account/telegram-link/begin"),
  );
  await telegram(page)
    .getByRole("button", { name: "Подключить", exact: true })
    .click();
  const popup = await popupReady;
  const popupOrResponse = Promise.race([
    popup.waitForEvent("close").then(() => "popup closed"),
    result.then(() => "begin responded"),
  ]);
  await expect(popup).toHaveURL("about:blank");
  await entered(request, "begin");
  await showHome(page);
  expect(await popupOrResponse).toBe("popup closed");
  await page.goBack();
  const section = telegram(page);
  await expect(section.getByText("Telegram не подключён")).toBeVisible();
  await control(request, "release-begin");
  expect(await (await result).json()).toMatchObject({
    kind: "received",
    state: { linkRef, status: "pending" },
  });
  await expect(
    section.getByRole("button", { name: "Проверить подключение" }),
  ).toBeEnabled();
  await expect(
    section.getByRole("link", { name: "Открыть Telegram" }),
  ).toHaveCount(0);
});

test("a late confirmation failure does not replace the current Account screen", async ({
  baseURL,
  context,
  page,
  request,
}) => {
  await signIn(context, baseURL);
  await page.goto("/account");
  await beginTelegram(page, context);
  await control(request, "hold-confirm");
  await control(request, "confirm-unavailable");
  const result = page.waitForResponse((entry) =>
    entry.url().endsWith("/api/account/telegram-link/confirm"),
  );
  await returnEvents(page, "visible", ["focus"]);
  expect(await entered(request, "confirm")).toEqual([confirmed]);
  await showHome(page);
  await page.goBack();
  const section = telegram(page);
  await expect(section.getByText("Подключаем Telegram")).toBeVisible();
  await control(request, "release-confirm");
  expect(await (await result).json()).toMatchObject({ kind: "unavailable" });
  await expect(
    section.getByRole("button", { name: "Проверить подключение" }),
  ).toBeEnabled();
  await browserTurn(page);
  await expect(section.getByRole("alert")).toHaveCount(0);
});

test("a pending Telegram continuation polls and replaces its address with the active programme", async ({
  baseURL,
  context,
  page,
  request,
}) => {
  await signIn(context, baseURL);
  // Run the browser's actual interval under controlled time.
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2030-01-01T00:01:00Z"));
  await page.goto("/");
  const path = `/telegram/continue?attempt=${attemptId}`;
  const pending = page.waitForResponse((entry) =>
    entry.url().endsWith(`/api/account/telegram-activation/${attemptId}`),
  );
  await page.goto(path);
  expect(await (await pending).json()).toMatchObject({ state: "pending" });
  await browserTurn(page);
  await page.clock.runFor(1);
  await expect(
    page.getByText("Проверяем доступ к выбранному курсу…"),
  ).toBeVisible();
  await control(request, "active");
  const reads = () =>
    request
      .get(`${fixture}?checkpoint=activation`)
      .then((response) => response.json());
  await page.clock.runFor(998);
  await browserTurn(page);
  expect(await reads()).toBe(1);
  const activation = page.waitForResponse((entry) =>
    entry.url().endsWith(`/api/account/telegram-activation/${attemptId}`),
  );
  await page.clock.runFor(1);
  expect(await (await activation).json()).toMatchObject({ state: "active" });
  expect(await reads()).toBe(2);
  await browserTurn(page);
  await page.clock.runFor(1);
  await expect(page).toHaveURL(/\/products\/navigation-proof\/programme$/u);
  await expect(
    page.getByRole("heading", { name: /Проверочный продукт/u }).first(),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/u);
});

test("leaving a pending Telegram continuation keeps the home page after a late active response", async ({
  baseURL,
  context,
  page,
  request,
}) => {
  await signIn(context, baseURL);
  await page.goto(`/telegram/continue?attempt=${attemptId}`);
  await expect(
    page.getByText("Проверяем доступ к выбранному курсу…"),
  ).toBeVisible();
  await control(request, "active");
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const settled = Promise.withResolvers<void>();
  await page.route(
    `**/api/account/telegram-activation/${attemptId}`,
    async (route) => {
      try {
        const response = await route.fetch();
        expect(await response.json()).toMatchObject({ state: "active" });
        ready.resolve();
        await release.promise;
        await route.fulfill({ response });
        settled.resolve();
      } catch (error) {
        ready.reject(error);
        settled.reject(error);
      }
    },
  );
  try {
    await ready.promise;
    await page
      .getByRole("link", { name: /^sachkov\.dev(?:, Главная)?$/u })
      .click();
    await expect(page).toHaveURL(/\/$/u);
    await expect(
      page.getByText("Проверяем доступ к выбранному курсу…"),
    ).toBeHidden();
  } finally {
    release.resolve();
  }
  await settled.promise;
  await browserTurn(page);
  await expect(page).toHaveURL(/\/$/u);
});
