import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext } from "@playwright/test";

async function session(context: BrowserContext, name: "FULLSTACK_LOGTO_SESSION" | "FULLSTACK_LOGTO_MEMBER_SESSION") {
  const value = process.env[name];
  const cookieName = process.env.FULLSTACK_LOGTO_COOKIE_NAME;
  if (value === undefined || cookieName === undefined) throw new Error("Full-stack identity fixture is missing");
  await context.addCookies([{ name: cookieName, value, url: process.env.FULLSTACK_WEB_BASE_URL ?? "http://127.0.0.1:3000", httpOnly: true, sameSite: "Lax" }]);
}

test("author Home pin persists for guests and members, replaces and removes through the real BFF", async ({ page, context, browser, baseURL }, testInfo) => {
  await session(context, "FULLSTACK_LOGTO_SESSION");
  const guest = await browser.newContext({ baseURL: baseURL ?? "http://127.0.0.1:3000", viewport: page.viewportSize() });
  const guestPage = await guest.newPage();
  const member = await browser.newContext({ baseURL: baseURL ?? "http://127.0.0.1:3000" });
  await session(member, "FULLSTACK_LOGTO_MEMBER_SESSION");
  const memberPage = await member.newPage();
  try {
    const { promise: pinReady, resolve: releasePin } = Promise.withResolvers<undefined>();
    await page.route("**/api/authoring/home-pin", async (route) => {
      await pinReady;
      await route.continue();
    }, { times: 1 });
    const loadedMaterials = page.waitForResponse((response) => response.url().includes("/api/authoring/materials?") && response.status() === 200);
    await page.goto("/authoring/materials?search=Как%20устроен%20Inside%20Platform");
    await loadedMaterials;
    // The ready list never paints with a missing pin state and shifts again on hydration.
    await expect(page.getByRole("main", { name: "Загрузка списка материалов" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Как устроен Inside Platform", exact: true })).toHaveCount(0);
    releasePin(undefined);
    const row = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Как устроен Inside Platform", exact: true }) });
    await row.getByRole("button", { name: "Закрепить на главной", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Материал закреплён на главной." })).toBeVisible();
    await page.reload();
    await expect(row.getByRole("button", { name: "Снять закреп с главной" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("authoring-pin.png"), fullPage: true });
    for (const viewer of [guestPage, memberPage]) {
      await viewer.goto("/");
      await expect(viewer.locator("#featured-title:visible")).toHaveText("Как устроен Inside Platform");
      await expect(viewer.getByRole("link", { name: "Открыть материал", exact: true })).toHaveAttribute("href", "/materials/kak-ustroen-inside-platform?from=%2F");
      await expect(viewer.locator(".home-presenter img:visible")).toBeVisible();
    }
    const scan = await new AxeBuilder({ page: guestPage }).analyze();
    expect(scan.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
    await guestPage.screenshot({ path: testInfo.outputPath("home-pin.png") });
    await guestPage.addStyleTag({ content: "html { font-size: 200% !important; }" });
    expect(await guestPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(guestPage.viewportSize()?.width ?? 1440);
    await guestPage.screenshot({ path: testInfo.outputPath("home-pin-text-200.png") });
    const forbidden = await memberPage.evaluate(async (): Promise<unknown> => {
      const body = new FormData(); body.set("materialId", ""); body.set("expectedVersion", "1");
      const result: unknown = await (await fetch("/api/authoring/home-pin", { method: "PUT", body })).json();
      return result;
    });
    expect(forbidden).toEqual({ kind: "forbidden" });

    await page.goto("/authoring/materials?search=Developer%20Pipeline%20без%20потери%20контекста");
    const second = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Developer Pipeline без потери контекста", exact: true }) });
    await second.getByRole("button", { name: "Закрепить на главной", exact: true }).click();
    await expect(second.getByRole("button", { name: "Снять закреп с главной" })).toBeVisible();
    await guestPage.goto("/");
    await expect(guestPage.locator("#featured-title:visible")).toHaveText("Developer Pipeline без потери контекста");
    await guestPage.getByRole("link", { name: "Открыть материал", exact: true }).click();
    await expect(guestPage.getByRole("link", { name: "Получить доступ", exact: true })).toBeVisible();
    await second.getByRole("button", { name: "Снять закреп с главной" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Закреп снят с главной." })).toBeVisible();
    await guestPage.goto("/");
    await expect(guestPage.locator("#featured-title")).toHaveCount(0);
  } finally {
    // Restore this smoke's shared fixture even if a browser assertion failed.
    await page.evaluate(async () => {
      const current: unknown = await (await fetch("/api/authoring/home-pin")).json();
      if (typeof current !== "object" || current === null || !("kind" in current) || current.kind !== "ready" || !("pin" in current)) return;
      const pin = current.pin;
      if (typeof pin !== "object" || pin === null || !("version" in pin) || typeof pin.version !== "number") return;
      const body = new FormData(); body.set("materialId", ""); body.set("expectedVersion", String(pin.version));
      await fetch("/api/authoring/home-pin", { method: "PUT", body });
    });
    await guest.close(); await member.close();
  }
});
