import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
async function signIn(context: BrowserContext, persona = "NON_MEMBER") {
  const name = process.env.FULLSTACK_LOGTO_COOKIE_NAME; const value = process.env[`FULLSTACK_LOGTO_${persona}_SESSION`];
  if (name === undefined || value === undefined) throw new Error("Missing local identity fixture");
  await context.addCookies([{ name, value, url: process.env.FULLSTACK_WEB_BASE_URL ?? "http://127.0.0.1:3000", httpOnly: true, sameSite: "Lax" }]);
}
async function dismissOnboarding(page: Page) {
  const dismiss = page.getByRole("button", { name: "Закрыть подключение Telegram" });
  await page.addLocatorHandler(dismiss, async () => { await dismiss.click(); });
}
async function unmark(page: Page, label: string) {
  const action = page.locator("[data-reading-action-state]:visible");
  await expect(action).toHaveAttribute("data-reading-action-state", "ready");
  const button = action.getByRole("button", { name: label, exact: true });
  if (await button.getAttribute("aria-pressed") === "true") { await button.click(); await expect(button).toHaveAttribute("aria-pressed", "false"); }
  return button;
}

const seriesSlug = "demo-progress-series";
const materialSlugs = ["tekst-dlya-proverki-progressa", "video-pro-developer-pipeline", "gayd-dlya-proverki-progressa"] as const;
async function resetSeries(page: Page) {
  for (const [index, slug] of materialSlugs.entries()) {
    await page.goto(`/materials/${slug}`);
    await unmark(page, ["Прочитано", "Просмотрено", "Изучено"][index] ?? "Изучено");
  }
}
async function personal(page: Page) {
  const response = await page.request.post("/api/personal-home", { headers: { origin: new URL(page.url()).origin }, multipart: {} });
  expect(response.headers()["cache-control"]).toContain("private");
  return response;
}
async function screenshot(page: Page, project: string, surface: string) {
  const directory = resolve("../../docs/evidence/issue-332"); await mkdir(directory, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined))); });
  const captureViewport = project.startsWith("mobile") && surface !== "home";
  if (captureViewport && surface === "series") await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); });
  await page.screenshot({ path: resolve(directory, `${project}-inline-${surface}.png`), fullPage: !captureViewport });
}
test("personal Home opens the real series, persists marks and reconciles a lost visible open", async ({ page, context }, testInfo) => {
  await signIn(context, "EXPIRED_MEMBER"); await dismissOnboarding(page); await resetSeries(page);
  await page.goto(`/materials/${materialSlugs[0]}`); const otherMark = await unmark(page, "Прочитано");
  await otherMark.click(); await expect(otherMark).toHaveAttribute("aria-pressed", "true");
  await signIn(context); await resetSeries(page);
  // Dispose the previous Reader before intercepting the new visible open.
  await page.goto("about:blank");
  const commands: string[] = []; let lost = true;
  await page.route("**/api/reading-progress/open", async (route) => {
    commands.push(route.request().postData() ?? "");
    if (lost) { lost = false; await route.fetch(); await route.abort("failed"); } else await route.continue();
  });
  const opened = page.waitForResponse((response) =>
    commands.length >= 2 && response.url().endsWith("/api/reading-progress/open") && response.status() === 200,
  );
  await page.goto(`/materials/${materialSlugs[0]}`); const button = await unmark(page, "Прочитано"); await opened;
  expect(commands.length).toBeGreaterThanOrEqual(2);
  const commandId = (body: string) => /name="commandId"\r\n\r\n([^\r]+)/u.exec(body)?.[1];
  expect(commandId(commands[0] ?? "")).toBeTruthy(); expect(commandId(commands[1] ?? "")).toBe(commandId(commands[0] ?? ""));
  await button.click(); await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.goto("/");
  const resumeSeries = page.getByRole("link", { name: "Продолжить серию Demo · Прогресс обучения" });
  await expect(resumeSeries).toContainText("изучено 1 из 3");
  await expect(resumeSeries).toHaveAttribute("href", `/series/${seriesSlug}?from=%2F`);
  await expect(page.getByRole("region", { name: "Продолжить изучение" })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
  await screenshot(page, testInfo.project.name, "home");
  await resumeSeries.click();
  await expect(page).toHaveURL(new RegExp(`/series/${seriesSlug}`));
  await expect(page.getByRole("main").locator("[data-series-progress]")).toContainText("Изучено 1 из 3");
  await expect(page.getByRole("main").locator('[data-series-marker-read="true"]')).toHaveCount(1);
  const current = page.getByRole("main").locator('[aria-current="step"]');
  await expect(current.locator("[data-material-slug]")).toHaveAttribute("data-material-slug", "video-pro-developer-pipeline");
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
  await screenshot(page, testInfo.project.name, "series");
  const nextRow = page.getByRole("main").locator('[data-series-ordinal="3"]');
  const rowBefore = await nextRow.boundingBox();
  await page.route("**/api/reading-progress/series-continuation", async (route) => { await route.fulfill({ status: 503 }); });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("main").locator("[data-series-progress]")).toContainText("Прогресс пока недоступен");
  await expect(current).toHaveCount(0); expect(await nextRow.boundingBox()).toEqual(rowBefore);
  await page.unroute("**/api/reading-progress/series-continuation"); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(current.locator("[data-material-slug]")).toHaveAttribute("data-material-slug", "video-pro-developer-pipeline");
  await current.locator('a[href^="/materials/video-pro-developer-pipeline"]').click();
  await expect(page.getByText("Материал 2 из 3", { exact: true })).toBeVisible();
  const videoMark = await unmark(page, "Просмотрено"); await videoMark.click(); await expect(videoMark).toHaveAttribute("aria-pressed", "true");
  await page.goto(`/series/${seriesSlug}`); await expect(current).toContainText("Гайд для проверки прогресса");
  await page.reload(); await expect(page.getByRole("main").locator("[data-series-progress]")).toContainText("Изучено 2 из 3");
  await current.getByRole("link", { name: "Гайд для проверки прогресса", exact: true }).click();
  const guideMark = await unmark(page, "Изучено"); await guideMark.click(); await expect(guideMark).toHaveAttribute("aria-pressed", "true");
  await page.goto(`/series/${seriesSlug}`); await expect(current).toHaveCount(0); await expect(page.getByRole("main").getByText("Все материалы изучены", { exact: true })).toBeVisible();
  await page.goto("/"); await expect(resumeSeries).toHaveCount(0);
  await page.goto(`/materials/${materialSlugs[0]}`); await unmark(page, "Прочитано");
  await page.goto("/"); await expect(resumeSeries).toContainText("изучено 2 из 3");
  await context.clearCookies(); await page.goto("/"); await expect(resumeSeries).toHaveCount(0);
  await signIn(context); await page.reload(); await expect(resumeSeries).toContainText("изучено 2 из 3");
  await signIn(context, "EXPIRED_MEMBER"); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(resumeSeries).toContainText("изучено 1 из 3"); await personal(page);
});

test("personal Home resumes real Video progress in the normal video section and excludes playback end", async ({ page, context }, testInfo) => {
  await signIn(context, "MEMBER"); await dismissOnboarding(page);
  // The iframe SDK is the only double; playback sessions and progress use the API and PostgreSQL.
  await page.route("https://kinescope.io/**", async (route) => { await route.fulfill({ contentType: "text/html", body: "<title>Local video provider</title>" }); });
  await page.addInitScript(() => {
    Object.defineProperty(window, "Kinescope", { value: { IframePlayer: { version: "1.0.0", create: (mount: HTMLElement, options: { url: string }) => {
      const iframe = document.createElement("iframe"); iframe.src = options.url; iframe.style.cssText = "width:100%;height:100%;border:0"; mount.append(iframe);
      return Promise.resolve({ Events: { TimeUpdate: "time", Pause: "pause", Ended: "ended" }, destroy: () => { iframe.remove(); return Promise.resolve(); }, getDuration: () => Promise.resolve(628), on: () => undefined, seekTo: (seconds: number) => { iframe.dataset.seekSeconds = String(seconds); return Promise.resolve(); } });
    } } } });
  });
  const opened = page.waitForResponse((response) => response.url().endsWith("/api/reading-progress/open") && response.status() === 200);
  await page.goto("/materials/video-pro-developer-pipeline"); const mark = await unmark(page, "Просмотрено"); await opened;
  const materialId = await page.getByRole("main").locator("[data-material-id]").getAttribute("data-material-id");
  const videoId = await page.getByRole("main").locator("[data-video-id]").getAttribute("data-video-id");
  if (materialId === null || videoId === null) throw new Error("Missing real video identity");
  async function save(positionSeconds: string) {
    const response = await page.request.put("/api/material-video-progress", { headers: { origin: new URL(page.url()).origin }, multipart: { durationSeconds: "628", materialId: materialId ?? "", videoId: videoId ?? "", positionSeconds } });
    expect(await response.json()).toEqual({ kind: "saved" });
  }
  await save("123"); await page.goto("/");
  const videos = page.getByRole("region", { name: "Новые видео" });
  const card = videos.locator('[data-material-slug="video-pro-developer-pipeline"]');
  await expect(videos.getByRole("article").first()).toHaveAttribute("data-material-slug", "video-pro-developer-pipeline");
  await expect(card).toContainText("Продолжить с 2:03"); await expect(card).toContainText("Продолжить просмотр");
  await expect(card).toHaveCount(1); await card.scrollIntoViewIfNeeded(); await screenshot(page, testInfo.project.name, "video");
  await card.getByRole("link").click();
  await expect(page.locator("[data-video-player-mount] iframe")).toHaveAttribute("data-seek-seconds", "123");
  await save("628"); await page.goto("/"); await expect(videos.getByText("Продолжить просмотр", { exact: true })).toHaveCount(0);
  await page.goto("/materials/video-pro-developer-pipeline"); await expect(mark).toHaveAttribute("aria-pressed", "false");
  await save("123"); await mark.click(); await expect(mark).toHaveAttribute("aria-pressed", "true");
  await page.goto("/"); await expect(videos.getByText("Продолжить просмотр", { exact: true })).toHaveCount(0);
});

test("personal Home preserves the public hub through errors and excludes denied, prefetched and SSR opens", async ({ page, context }) => {
  await signIn(context); await dismissOnboarding(page);
  const opens: string[] = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/reading-progress/open")) opens.push(request.url()); });
  await page.goto("/");
  await page.request.get("/materials/demo-podgotovka-prilozheniya-k-relizu", { headers: { "next-router-prefetch": "1", rsc: "1" } });
  expect(opens).toEqual([]);
  await page.goto("/materials/developer-pipeline-bez-poteri-konteksta");
  await expect(page.locator("[data-reader-body]:visible")).toHaveCount(0); expect(opens).toEqual([]);
  await page.goto("/");
  await expect(page.locator("[data-personal-home-state]")).toHaveAttribute("data-personal-home-state", "ready");
  const series = page.getByRole("heading", { name: "Серии", exact: true });
  const before = (await series.boundingBox())?.y;
  await page.route("**/api/personal-home", async (route) => { await route.fulfill({ status: 503 }); });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("[data-personal-home-state]")).toHaveAttribute("data-personal-home-state", "unavailable");
  await expect(series).toBeVisible(); expect((await series.boundingBox())?.y).toBe(before);
  await expect(page.getByRole("link", { name: /^Продолжить серию/u })).toHaveCount(0);
  await page.unroute("**/api/personal-home"); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("[data-personal-home-state]")).toHaveAttribute("data-personal-home-state", "ready");
});

test("personal Home preserves SSR geometry through authenticated hydration", async ({ page, context }) => {
  await signIn(context); await dismissOnboarding(page);
  const { promise, resolve: release } = Promise.withResolvers<undefined>();
  await page.route("**/*.js*", async (route) => { await promise; await route.continue(); });
  await page.goto("/", { waitUntil: "commit" });
  const series = page.getByRole("heading", { name: "Серии", exact: true }); await expect(series).toBeVisible();
  await page.evaluate(() => document.fonts.ready); const before = await series.boundingBox(); release(undefined);
  await page.waitForResponse((response) => response.url().endsWith("/api/personal-home") && response.status() === 200);
  expect((await series.boundingBox())?.y).toBe(before?.y);
});

test("personal Home waits for document visibility before recording an available Reader", async ({ page, context }) => {
  await signIn(context); await dismissOnboarding(page);
  await page.addInitScript(() => {
    let hidden = true;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => hidden ? "hidden" : "visible" });
    window.addEventListener("test-reader-visible", () => { hidden = false; document.dispatchEvent(new Event("visibilitychange", { bubbles: true })); });
  });
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/reading-progress/open")) requests.push(request.url()); });
  await page.goto("/materials/kak-ustroen-inside-platform");
  await unmark(page, "Изучено");
  await expect(page.locator("[data-reader-body]:visible")).toBeVisible();
  expect(requests).toEqual([]);
  const opened = page.waitForResponse((response) => response.url().endsWith("/api/reading-progress/open") && response.status() === 200);
  await page.evaluate(() => window.dispatchEvent(new Event("test-reader-visible")));
  await opened;
  expect(requests).toHaveLength(1);
});

test("personal Home retries an already visible open with the same command after the tab is hidden", async ({ page, context }) => {
  await signIn(context); await dismissOnboarding(page);
  const commands: string[] = [];
  await page.route("**/api/reading-progress/open", async (route) => {
    commands.push(route.request().postData() ?? "");
    if (commands.length === 1) {
      await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange", { bubbles: true })); });
      await route.abort("failed");
    } else await route.continue();
  });
  const opened = page.waitForResponse((response) => response.url().endsWith("/api/reading-progress/open") && response.status() === 200);
  await page.goto("/materials/kak-ustroen-inside-platform");
  await expect.poll(() => commands.length).toBe(1);
  // Cross the retry delay while hidden: TanStack may pause delivery, but it must retain the command.
  await page.waitForTimeout(1_200);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange", { bubbles: true })); });
  await opened;
  const commandId = (body: string) => /name="commandId"\r\n\r\n([^\r]+)/u.exec(body)?.[1];
  expect(commandId(commands[0] ?? "")).toBeTruthy(); expect(commandId(commands[1] ?? "")).toBe(commandId(commands[0] ?? ""));
});
