import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { z } from "zod";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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
async function personal(page: Page) {
  const response = await page.request.post("/api/personal-home", { headers: { origin: new URL(page.url()).origin }, multipart: {} });
  expect(response.headers()["cache-control"]).toContain("private");
  return z.object({ kind: z.string(), items: z.array(z.object({ id: z.string() })).optional() }).parse(await response.json());
}
test("personal Home records a visible free Reader, reconciles a lost open and excludes manual completion", async ({ page, context }, testInfo) => {
  await signIn(context); await dismissOnboarding(page);
  const commands: string[] = []; let lost = true;
  await page.route("**/api/reading-progress/open", async (route) => {
    commands.push(route.request().postData() ?? "");
    if (lost) { lost = false; await route.fetch(); await route.abort("failed"); } else await route.continue();
  });
  const opened = page.waitForResponse((response) => response.url().endsWith("/api/reading-progress/open") && response.status() === 200);
  await page.goto("/materials/tekst-dlya-proverki-progressa");
  const button = await unmark(page, "Прочитано");
  await opened;
  expect(commands.length).toBeGreaterThanOrEqual(2);
  const commandId = (body: string) => /name="commandId"\r\n\r\n([^\r]+)/u.exec(body)?.[1];
  expect(commandId(commands[0] ?? "")).toBeTruthy(); expect(commandId(commands[1] ?? "")).toBe(commandId(commands[0] ?? ""));
  const id = await page.locator("[data-material-id]:visible").getAttribute("data-material-id");
  if (id === null) throw new Error("Missing material identity");
  await page.goto("/");
  const card = page.locator(`[data-continue-material="${id}"]`);
  await expect(card).toContainText("Открыть материал");
  expect((await new AxeBuilder({ page }).include("[data-personal-home-state]").analyze()).violations).toEqual([]);
  await mkdir(resolve("../../docs/evidence/issue-332"), { recursive: true });
  await page.screenshot({ path: resolve(`../../docs/evidence/issue-332/${testInfo.project.name}-continue-text.png`) });
  await card.getByRole("link").click();
  await expect(page.locator("[data-reader-body]:visible")).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "false"); await button.click(); await expect(button).toHaveAttribute("aria-pressed", "true");
  await page.goto("/"); await expect(card).toHaveCount(0);
  await page.goto("/materials/tekst-dlya-proverki-progressa"); await unmark(page, "Прочитано");
  await page.goto("/"); await expect(card).toBeVisible();
  await signIn(context, "EXPIRED_MEMBER"); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  // Query identity changes without replacing the page/QueryClient.
  await expect.poll(async () => (await personal(page)).items?.some((item: { id: string }) => item.id === id)).toBe(false);
  await expect(card).toHaveCount(0);
  await context.clearCookies(); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("[data-personal-home-state]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Серии", exact: true })).toBeVisible();
});

test("personal Home resumes the current video through real playback and offers manual completion at the end", async ({ page, context }, testInfo) => {
  await signIn(context, "MEMBER"); await dismissOnboarding(page);
  // Only the external iframe SDK is replaced. Sessions and progress use the real API and DB.
  await page.route("https://kinescope.io/**", async (route) => { await route.fulfill({ contentType: "text/html", body: "<title>Local video provider</title>" }); });
  await page.addInitScript(() => {
    Object.defineProperty(window, "Kinescope", { value: { IframePlayer: { version: "1.0.0", create: (mount: HTMLElement, options: { url: string }) => {
      const iframe = document.createElement("iframe"); iframe.src = options.url; iframe.style.cssText = "width:100%;height:100%;border:0"; mount.append(iframe);
      return Promise.resolve({ Events: { TimeUpdate: "time", Pause: "pause", Ended: "ended" }, destroy: () => { iframe.remove(); return Promise.resolve(); }, getDuration: () => Promise.resolve(628), on: () => undefined, seekTo: (seconds: number) => { iframe.dataset.seekSeconds = String(seconds); return Promise.resolve(); } });
    } } } });
  });
  const opened = page.waitForResponse((response) => response.url().endsWith("/api/reading-progress/open") && response.status() === 200);
  await page.goto("/materials/video-pro-developer-pipeline"); await unmark(page, "Просмотрено"); await opened;
  const materialId = await page.locator("[data-material-id]:visible").getAttribute("data-material-id");
  const videoId = await page.locator("[data-video-id]:visible").getAttribute("data-video-id");
  if (materialId === null || videoId === null) throw new Error("Missing real video identity");
  async function save(positionSeconds: string) {
    const response = await page.request.put("/api/material-video-progress", { headers: { origin: new URL(page.url()).origin }, multipart: { durationSeconds: "628", materialId: materialId ?? "", videoId: videoId ?? "", positionSeconds } });
    expect(await response.json()).toEqual({ kind: "saved" });
  }
  await save("123"); await page.goto("/");
  const card = page.locator(`[data-continue-material="${materialId}"]`);
  await expect(card).toContainText("Продолжить с 2:03");
  await page.screenshot({ path: resolve(`../../docs/evidence/issue-332/${testInfo.project.name}-resume.png`) });
  await card.getByRole("link").click();
  await expect(page.locator("[data-video-player-mount] iframe")).toHaveAttribute("data-seek-seconds", "123");
  await save("628"); await page.goto("/");
  await expect(card).toContainText("Видео просмотрено до конца — можно отметить материал");
  const mark = card.getByRole("button", { name: "Просмотрено", exact: true });
  await expect(mark).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: resolve(`../../docs/evidence/issue-332/${testInfo.project.name}-reached-end.png`) });
  await mark.click(); await expect(card).toHaveCount(0);
});

test("personal Home keeps public content through personal failure and does not track SSR, prefetch or denied bodies", async ({ page, context }) => {
  await signIn(context); await dismissOnboarding(page);
  const opens: string[] = [];
  page.on("request", (request) => { if (request.url().endsWith("/api/reading-progress/open")) opens.push(request.url()); });
  await page.goto("/");
  await page.request.get("/materials/demo-podgotovka-prilozheniya-k-relizu", { headers: { "next-router-prefetch": "1", rsc: "1" } });
  await page.getByRole("heading", { name: "Серии", exact: true }).hover();
  expect(opens).toEqual([]);
  await page.goto("/materials/developer-pipeline-bez-poteri-konteksta");
  await expect(page.locator("[data-reading-action-state]:visible")).toHaveAttribute("data-reading-action-state", "ready");
  await expect(page.locator("[data-reader-body]:visible")).toHaveCount(0); expect(opens).toEqual([]);
  await page.goto("/");
  await expect(page.locator("[data-personal-home-state]")).toHaveAttribute("data-personal-home-state", "ready");
  const series = page.getByRole("heading", { name: "Серии", exact: true });
  await expect(series).toBeVisible();
  const beforeFailure = await series.boundingBox();
  await page.route("**/api/personal-home", async (route) => { await route.fulfill({ status: 503 }); });
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange", { bubbles: true })); });
  await expect(page.locator("[data-personal-home-state]")).toHaveAttribute("data-personal-home-state", "unavailable");
  await expect(page.getByRole("heading", { name: "Серии", exact: true })).toBeVisible();
  expect((await series.boundingBox())?.y).toBe(beforeFailure?.y);
  await page.unroute("**/api/personal-home");
  await page.getByRole("button", { name: "Попробовать ещё раз" }).click();
  await expect(page.locator("[data-personal-home-state]")).toHaveAttribute("data-personal-home-state", "ready");
  await context.clearCookies(); await page.goto("/"); await expect(page.locator("[data-personal-home-state]")).toHaveCount(0);
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

test("personal Home preserves SSR geometry through authenticated hydration", async ({ page, context }) => {
  await signIn(context); await dismissOnboarding(page);
  const { promise, resolve: release } = Promise.withResolvers<undefined>();
  await page.route("**/*.js*", async (route) => { await promise; await route.continue(); });
  const navigation = page.goto("/", { waitUntil: "commit" });
  await navigation;
  const series = page.getByRole("heading", { name: "Серии", exact: true });
  await expect(series).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const before = await series.boundingBox();
  release(undefined);
  await expect(page.locator("[data-personal-home-state]")).toHaveAttribute("data-personal-home-state", "ready");
  await page.waitForResponse((response) => response.url().endsWith("/api/personal-home") && response.status() === 200);
  expect((await series.boundingBox())?.y).toBe(before?.y);
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

test("personal Home hides expired content and restores the same visit after rejoining", async ({ page, context }) => {
  await signIn(context, "MEMBER"); await dismissOnboarding(page);
  const transition = async (decision: "member" | "not_member") => {
    const { stdout } = await promisify(execFile)("pnpm", ["--filter", "@inside/backend", "smoke:set-full-stack-membership", decision], { cwd: resolve("../.."), env: process.env });
    return z.object({ kind: z.string(), visit: z.object({ firstOpenedAt: z.string(), lastOpenedAt: z.string() }).nullable() }).parse(JSON.parse(stdout.slice(stdout.indexOf("{"))));
  };
  await transition("member");
  try {
    const opened = page.waitForResponse((response) => response.url().endsWith("/api/reading-progress/open") && response.status() === 200);
    await page.goto("/materials/developer-pipeline-bez-poteri-konteksta"); await unmark(page, "Изучено"); await opened;
    const id = await page.locator("[data-material-id]:visible").getAttribute("data-material-id");
    if (id === null) throw new Error("Missing protected material identity");
    await page.goto("/"); const card = page.locator(`[data-continue-material="${id}"]`); await expect(card).toBeVisible();
    const expired = await transition("not_member"); expect(expired.kind).toBe("expired"); expect(expired.visit).not.toBeNull();
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange", { bubbles: true })); });
    await expect(card).toHaveCount(0);
    const restored = await transition("member"); expect(restored.kind).toBe("active"); expect(restored.visit).toEqual(expired.visit);
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange", { bubbles: true })); });
    await expect(card).toBeVisible();
  } finally { await transition("member"); }
});
