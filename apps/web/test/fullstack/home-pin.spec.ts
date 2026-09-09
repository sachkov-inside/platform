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
    await page.goto("/authoring/materials");
    await expect(page.getByRole("button", { name: "Закрепить на главной", exact: true })).toHaveCount(0);
    const { promise: pinReady, resolve: releasePin } = Promise.withResolvers<undefined>();
    await page.route("**/api/authoring/home-pin", async (route) => { await pinReady; await route.fulfill({ status: 503, contentType: "application/json", body: "{}" }); }, { times: 1 });
    await page.goto("/authoring/guides");
    const releaseName = "Demo · Релиз своего проекта";
    const pin = page.getByRole("list", { name: "Все руководства" });
    const pinButton = () => pin.getByRole("button", { name: `Закрепить «${releaseName}» на главной` });
    await expect(pinButton()).toBeDisabled();
    const loadingBox = await pin.boundingBox();
    releasePin(undefined);
    await expect(page.getByRole("button", { name: "Обновить закреп" })).toBeEnabled();
    expect((await pin.boundingBox())?.y).toBe(loadingBox?.y);
    await page.getByRole("button", { name: "Обновить закреп" }).click();
    await expect(pinButton()).toBeEnabled();
    expect((await pin.boundingBox())?.y).toBe(loadingBox?.y);
    await pinButton().click();
    await expect(pin.getByRole("button", { name: `Снять закреп «${releaseName}»` })).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(pin.getByRole("button", { name: `Снять закреп «${releaseName}»` })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("authoring-pin.png"), fullPage: true });
    const editorHref = await pin.getByRole("link", { name: new RegExp(releaseName, "u") }).getAttribute("href");
    expect(editorHref).toMatch(/^\/authoring\/guides\//u);
    if (editorHref === null) throw new Error("Guide editor link is missing");
    // Legacy deep links open the same editor and the same persisted Guide selection.
    await page.goto(editorHref.replace("/authoring/guides/", "/authoring/playlists/"));
    await expect(page.getByRole("textbox", { name: "Название руководства" })).toHaveValue(releaseName);
    await expect(page.getByRole("button", { name: "Снять закреп с главной", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Снять закреп с главной", exact: true }).click();
    await expect(page.getByText("Закреп снят с главной.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Закрепить на главной", exact: true }).click();
    await expect(page.getByText("Руководство закреплено на главной.", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("guide-editor.png"), fullPage: true });
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 1440);
    await page.screenshot({ path: testInfo.outputPath("guide-editor-text-200.png"), fullPage: true });
    await page.reload();
    await page.getByRole("button", { name: "Все руководства", exact: true }).click();
    await expect(page).toHaveURL(/\/authoring\/guides$/u);
    await expect(pin.getByRole("button", { name: `Снять закреп «${releaseName}»` })).toBeVisible();
    for (const viewer of [guestPage, memberPage]) {
      await viewer.goto("/");
      await expect(viewer.locator("#featured-title:visible")).toHaveText("Demo · Релиз своего проекта");
      await expect(viewer.getByRole("link", { name: "Открыть руководство", exact: true })).toHaveAttribute("href", "/guides/demo-series-release?from=%2F");
      await expect(viewer.locator(".home-presenter img:visible")).toBeVisible();
    }
    const scan = await new AxeBuilder({ page: guestPage }).analyze();
    expect(scan.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
    await guestPage.screenshot({ path: testInfo.outputPath("home-pin.png") });
    await guestPage.addStyleTag({ content: "html { font-size: 200% !important; }" });
    expect(await guestPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(guestPage.viewportSize()?.width ?? 1440);
    await guestPage.screenshot({ path: testInfo.outputPath("home-pin-text-200.png") });
    const forbidden = await memberPage.evaluate(async (): Promise<unknown> => {
      const body = new FormData(); body.set("seriesId", ""); body.set("expectedVersion", "1");
      const result: unknown = await (await fetch("/api/authoring/home-pin", { method: "PUT", body })).json();
      return result;
    });
    expect(forbidden).toEqual({ kind: "forbidden" });

    const nextName = "Учебный пример · Подготовка проекта";
    await pin.getByRole("button", { name: `Закрепить «${nextName}» на главной` }).click();
    await expect(pin.getByRole("button", { name: `Снять закреп «${nextName}»` })).toBeVisible();
    await expect(pin.getByRole("button", { name: `Закрепить «${releaseName}» на главной` })).toHaveAttribute("aria-pressed", "false");
    await guestPage.goto("/");
    await expect(guestPage.locator("#featured-title:visible")).toHaveText("Учебный пример · Подготовка проекта");
    await guestPage.getByRole("link", { name: "Открыть руководство", exact: true }).click();
    await expect(guestPage).toHaveURL(/\/guides\/demo-series-release-shared/u);
    await pin.getByRole("button", { name: `Снять закреп «${nextName}»` }).click();
    await expect(pin.getByRole("button", { name: `Закрепить «${nextName}» на главной` })).toHaveAttribute("aria-pressed", "false");
    await guestPage.goto("/");
    await expect(guestPage.locator("#featured-title")).toHaveCount(0);
  } finally {
    // Restore this smoke's shared fixture even if a browser assertion failed.
    await page.evaluate(async () => {
      const current: unknown = await (await fetch("/api/authoring/home-pin")).json();
      if (typeof current !== "object" || current === null || !("kind" in current) || current.kind !== "ready" || !("pin" in current)) return;
      const pin = current.pin;
      if (typeof pin !== "object" || pin === null || !("version" in pin) || typeof pin.version !== "number") return;
      const body = new FormData(); body.set("seriesId", ""); body.set("expectedVersion", String(pin.version));
      await fetch("/api/authoring/home-pin", { method: "PUT", body });
    });
    await guest.close(); await member.close();
  }
});
