import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { signInFullStack } from "../support/full-stack-session";

async function openReader(page: Page, slug = "kak-ustroen-inside-platform", label = "Изучено") {
  await page.goto(`/materials/${slug}`);
  const dismiss = page.getByRole("button", { name: "Закрыть подключение Telegram" });
  await page.addLocatorHandler(dismiss, async () => { await dismiss.click(); });
  const action = page.locator("[data-reading-action-state]:visible");
  await expect(action).toHaveAttribute("data-reading-action-state", "ready");
  return action.getByRole("button", { name: label, exact: true });
}
test("reading progress persists for a free non-member, reconciles lost responses and isolates Accounts", async ({ page, context, browser }, testInfo) => {
  await signInFullStack(context);
  const button = await openReader(page);
  if (await button.getAttribute("aria-pressed") === "true") { await button.click(); await expect(button).toHaveAttribute("aria-pressed", "false"); }
  // The backend commits, but the browser loses the response. Retry must reuse the command.
  const commands: string[] = [];
  let loseResponse = true;
  await page.route("**/api/reading-progress/state", async (route) => {
    commands.push(route.request().postData() ?? "");
    if (loseResponse) { loseResponse = false; await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await button.click();
  await expect(page.locator("[data-reading-action-state]:visible").getByRole("alert")).toContainText("Не сохранено");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const command = (body: string) => /name="commandId"\r\n\r\n([^\r]+)/u.exec(body)?.[1];
  expect(command(commands[0] ?? "")).toBeTruthy();
  expect(command(commands[0] ?? "")).toBe(command(commands[1] ?? ""));
  await page.reload();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const directory = resolve(process.cwd(), "../../docs/evidence/issue-329");
  await mkdir(directory, { recursive: true });
  await expect(page.locator("[data-reading-action-state]:visible")).toHaveAttribute("data-reading-action-state", "ready");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await button.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(directory, `${testInfo.project.name}-reader.png`) });
  const accessibility = await new AxeBuilder({ page }).include("[data-reading-action-state]").analyze();
  expect(accessibility.violations).toEqual([]);
  await page.goto(`/library?q=${encodeURIComponent("Как устроен Inside Platform")}`);
  const card = page.getByRole("article").filter({ has: page.getByRole("link", { name: "Как устроен Inside Platform", exact: true }) });
  await expect(card.locator("[data-material-reading-status]")).toHaveText("Изучено");
  await page.screenshot({ path: resolve(directory, `${testInfo.project.name}-library.png`) });
  const other = await browser.newContext();
  try {
    await signInFullStack(other);
    const second = await other.newPage();
    const secondButton = await openReader(second);
    await expect(secondButton).toHaveAttribute("aria-pressed", "true");
    await secondButton.click();
    await expect(secondButton).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await expect(card.locator("[data-material-reading-status]")).toHaveCount(0);
    await other.clearCookies();
    await second.reload();
    await expect(second.locator("[data-reading-action-state]:visible")).toHaveAttribute("data-reading-action-state", "anonymous");
    expect(await second.locator("[data-material-reading-status]").count()).toBe(0);
  } finally { await other.close(); }
});


test("reading progress reconciles stale windows and account changes without reloading the app", async ({ page, context, browser }) => {
  await signInFullStack(context);
  const button = await openReader(page);
  if (await button.getAttribute("aria-pressed") === "true") { await button.click(); await expect(button).toHaveAttribute("aria-pressed", "false"); }
  const other = await browser.newContext();
  try {
    await signInFullStack(other);
    const second = await other.newPage();
    const otherButton = await openReader(second);
    await otherButton.click(); await expect(otherButton).toHaveAttribute("aria-pressed", "true");
    await button.click();
    await expect(page.locator("[data-reading-action-state]:visible")).toHaveAttribute("data-reading-action-state", "conflict");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Обновить статус" }).click();
    // Another authenticated identity, in the SAME page and QueryClient.
    await signInFullStack(context, "EXPIRED_MEMBER");
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator("[data-reading-action-state]:visible")).toHaveAttribute("data-reading-action-state", "ready");
    if (await button.getAttribute("aria-pressed") === "true") { await button.click(); await expect(button).toHaveAttribute("aria-pressed", "false"); }
    await signInFullStack(context);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await context.clearCookies();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator("[data-reading-action-state]:visible")).toHaveAttribute("data-reading-action-state", "anonymous");
  } finally { await other.close(); }
});

test("reading progress appears on Home and Topic for video and other formats", async ({ page, context }) => {
  await signInFullStack(context, "MEMBER");
  for (const material of [
    { slug: "video-pro-developer-pipeline", label: "Просмотрено", title: "Видео про Developer Pipeline" },
    { slug: "demo-chto-proverit-pered-peredachey-sekretov", label: "Прочитано", title: "Demo · Что проверить перед передачей секретов" },
  ]) {
    const button = await openReader(page, material.slug, material.label);
    if (await button.getAttribute("aria-pressed") !== "true") await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await page.goto("/");
    const card = page.getByRole("article").filter({ has: page.getByRole("link", { name: material.title, exact: true }) });
    await expect(card.locator("[data-material-reading-status]")).toHaveText(material.label);
    await page.goto("/topics/platform");
    await page.getByRole("searchbox").fill(material.title);
    await expect(card.locator("[data-material-reading-status]")).toHaveText(material.label);
  }
});

test("reading progress counts a shared material in both real Series", async ({ page, context }, testInfo) => {
  await signInFullStack(context, "EXPIRED_MEMBER");
  const button = await openReader(page, "demo-podgotovka-prilozheniya-k-relizu");
  if (await button.getAttribute("aria-pressed") !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const directory = resolve(process.cwd(), "../../docs/evidence/issue-329");
  await mkdir(directory, { recursive: true });
  for (const slug of ["demo-series-release", "demo-series-release-shared"]) {
    await page.goto(`/series/${slug}`);
    await expect(page.getByRole("main").locator("[data-series-progress]")).toContainText(/Изучено [1-9]/u);
    const card = page.getByRole("article").filter({ has: page.getByRole("link", { name: "Demo · Подготовка приложения к релизу", exact: true }) });
    await expect(card.locator("[data-material-reading-status]")).toHaveText("Изучено");
    if (slug.endsWith("shared")) {
      await expect(page.getByRole("main").locator("[data-series-progress]")).toContainText("Все материалы изучены");
      await page.screenshot({ path: resolve(directory, `${testInfo.project.name}-series.png`) });
    }
  }
  await openReader(page, "demo-podgotovka-prilozheniya-k-relizu");
  await button.click(); await expect(button).toHaveAttribute("aria-pressed", "false");
  await page.goto("/series/demo-series-release-shared");
  await expect(page.getByRole("main").locator("[data-series-progress]")).toContainText("Изучено 0 из 1");
  await expect(page.getByRole("main").getByText("Все материалы изучены")).toHaveCount(0);
});


test("reading progress supports Note and lets an expired member remove a protected mark", async ({ page, context }) => {
  await signInFullStack(context, "EXPIRED_MEMBER");
  const text = await openReader(page, "tekst-dlya-proverki-progressa", "Прочитано");
  if (await text.getAttribute("aria-pressed") !== "true") await text.click();
  await expect(text).toHaveAttribute("aria-pressed", "true");
  const protectedAction = await openReader(page, "developer-pipeline-bez-poteri-konteksta");
  await expect(page.locator("[data-reader-body]")).toHaveCount(0);
  // The development fixture marked this material while Membership was active, then expired it.
  // Desktop and mobile share that Account, so the second project observes the first one's removal.
  if (await protectedAction.getAttribute("aria-pressed") === "true") await protectedAction.click();
  await expect(protectedAction).toHaveAttribute("aria-pressed", "false");
  await expect(protectedAction).toHaveAttribute("aria-disabled", "true");
  await page.goto("/account");
  const signedOut = page.waitForResponse((response) => response.url().endsWith("/auth/sign-out") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Выйти из аккаунта", exact: true }).click();
  expect((await signedOut).status()).toBe(200);
  await page.goto("/materials/tekst-dlya-proverki-progressa");
  await expect(page.locator("[data-reading-action-state]:visible")).toHaveAttribute("data-reading-action-state", "anonymous");
});
