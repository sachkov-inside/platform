import { expect, test } from "@playwright/test";

const noticeKey = "inside.storage-notice.v1";

async function welcomeCookie(baseURL: string) {
  const port = process.env["FAKE_BACKEND_PORT"];
  if (port === undefined) throw new Error("Missing navigation backend port");
  const { wrapSession } = await import("@logto/node");
  const value = await wrapSession(
    {
      accessToken: JSON.stringify({
        [`@http://127.0.0.1:${port}`]: {
          // deterministic-test-allow wall-clock: The real Web/Logto session boundary validates this synthetic session against the live clock.
          expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
          scope: "",
          token: "compliance-lifetime-owner",
        },
      }),
      idToken: "compliance.id.token",
      refreshToken: "compliance-refresh-token",
    },
    "inside-navigation-logto-cookie-secret-key",
  );
  return {
    httpOnly: true,
    name: "logto_inside-web-navigation",
    sameSite: "Lax" as const,
    url: baseURL,
    value,
  };
}

// This fixture deliberately has no legal-acceptance API. It exercises the real unavailable route,
// not the accepted/newcomer backend flow, which requires the independent real application check.
test("welcome remains visible in server HTML without JavaScript", async ({
  browser,
  baseURL,
}, info) => {
  if (baseURL === undefined) throw new Error("Missing navigation Web URL");
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: info.project.use.viewport ?? { width: 1440, height: 1024 },
  });
  try {
    await context.addCookies([await welcomeCookie(baseURL)]);
    const page = await context.newPage();
    await page.goto("/welcome");
    const dialog = page.getByRole("dialog", { name: "Добро пожаловать" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("open", "");
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(
      false,
    );
    await expect(dialog.getByRole("alert")).toHaveText(
      "Не удалось загрузить условия. Обновите страницу позже.",
    );
    await expect(
      dialog.getByRole("link", { name: "На главную" }),
    ).toHaveAttribute("href", "/");
  } finally {
    await context.close();
  }
});

test("hydrated welcome keeps its modal on Escape and releases it for real navigation", async ({
  page,
  context,
  baseURL,
}) => {
  if (baseURL === undefined) throw new Error("Missing navigation Web URL");
  await context.addCookies([await welcomeCookie(baseURL)]);
  await page.goto("/welcome");
  const dialog = page.getByRole("dialog", { name: "Добро пожаловать" });
  await expect(dialog).toBeVisible();
  const retained = await dialog.elementHandle();
  await expect
    .poll(() => retained.evaluate((element) => element.matches(":modal")))
    .toBe(true);
  const action = dialog.getByRole("link", { name: "На главную" });
  await expect(action).toBeFocused();
  await page.keyboard.press("Escape");
  await expect
    .poll(() => retained.evaluate((element) => element.matches(":modal")))
    .toBe(true);
  await action.click();
  await expect(page).toHaveURL(baseURL + "/");
  await expect
    .poll(() => retained.evaluate((element) => element.matches(":modal")))
    .toBe(false);
  await page.goBack();
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((element) => element.matches(":modal")))
    .toBe(true);
});

for (const initialValue of [null, "prior-edition"] as const) {
  test(`acknowledging storage notice works without persistence (${initialValue === null ? "empty storage" : "non-current stored value"})`, async ({
    page,
  }) => {
    // Synthetic native storage fault for this one key; own application modules and other writes stay real.
    await page.addInitScript(
      ({ key, initialValue }) => {
        const local = window.localStorage;
        const session = window.sessionStorage;
        const writeLocal = local.setItem.bind(local);
        const writeSession = session.setItem.bind(session);
        if (initialValue !== null) writeLocal(key, initialValue);
        Storage.prototype.setItem = function (
          this: Storage,
          writtenKey: string,
          value: string,
        ) {
          if (this === local) {
            if (writtenKey === key)
              throw new DOMException(
                "Synthetic full storage",
                "QuotaExceededError",
              );
            writeLocal(writtenKey, value);
          } else if (this === session) {
            writeSession(writtenKey, value);
          } else {
            throw new TypeError("Unexpected native storage receiver");
          }
        };
      },
      { key: noticeKey, initialValue },
    );
    await page.goto("/legal/privacy");
    await expect(
      page.getByRole("button", { name: "Войти через Telegram" }).first(),
    ).toBeVisible();
    const notice = page.getByRole("region", { name: "Хранение в браузере" });
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "Понятно" }).click();
    await expect(notice).toBeHidden();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), noticeKey),
    ).toBe(initialValue);
    await page.reload();
    await expect(notice).toBeVisible();
  });
}

test("storage notice reserves its rendered height across responsive changes and releases it after acknowledgement", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/legal/privacy");
  const notice = page.getByRole("region", { name: "Хранение в браузере" });
  await expect(notice).toBeVisible();
  const initial = await notice.boundingBox();
  if (initial === null) throw new Error("Missing initial rendered notice");
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue(
          "--storage-notice-space",
        ),
      ),
    )
    .toBe(`${String(Math.round(initial.height))}px`);
  await page.setViewportSize({ width: 1440, height: 900 });
  // The notice Button animates its resize; the first changed box can be an intermediate height (#2400).
  await expect
    .poll(() =>
      notice.evaluate((element, previousHeight) => {
        const button = element.querySelector("button");
        if (button === null) throw new Error("Missing notice acknowledgement");
        const changed =
          element.getBoundingClientRect().height !== previousHeight;
        const resizing = button
          .getAnimations()
          .some(
            (animation) =>
              animation instanceof CSSTransition &&
              (animation.pending || animation.playState === "running"),
          );
        return changed && !resizing;
      }, initial.height),
    )
    .toBe(true);
  const changed = await notice.boundingBox();
  if (changed === null) throw new Error("Missing resized rendered notice");
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue(
          "--storage-notice-space",
        ),
      ),
    )
    .toBe(`${String(Math.round(changed.height))}px`);
  await notice.getByRole("button", { name: "Понятно" }).click();
  await expect(notice).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue(
          "--storage-notice-space",
        ),
      ),
    )
    .toBe("");
  await page.reload();
  await expect(notice).toBeHidden();
});

test("persisted storage events remain authoritative after a normal acknowledgement", async ({
  page,
  context,
}) => {
  await page.goto("/legal/privacy");
  const notice = page.getByRole("region", { name: "Хранение в браузере" });
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Понятно" }).click();
  await expect(notice).toBeHidden();
  const other = await context.newPage();
  try {
    await other.goto("/legal/terms");
    await other.evaluate((key) => {
      localStorage.setItem(key, "prior-edition");
    }, noticeKey);
    await expect(notice).toBeVisible();
  } finally {
    await other.close();
  }
});
