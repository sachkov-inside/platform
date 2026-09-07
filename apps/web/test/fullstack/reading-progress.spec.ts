import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
async function signIn(context: BrowserContext, persona = "NON_MEMBER") {
  const name = process.env.FULLSTACK_LOGTO_COOKIE_NAME;
  const value = process.env[`FULLSTACK_LOGTO_${persona}_SESSION`];
  if (name === undefined || value === undefined) throw new Error("Missing local identity fixture");
  await context.addCookies([{ name, value, url: process.env.FULLSTACK_WEB_BASE_URL ?? "http://127.0.0.1:3000", httpOnly: true, sameSite: "Lax" }]);
}
async function openReader(page: Page) {
  await page.goto("/materials/kak-ustroen-inside-platform");
  const dismiss = page.getByRole("button", { name: "Закрыть подключение Telegram" });
  if (await dismiss.isVisible()) await dismiss.click();
  const action = page.locator("[data-reading-action-state]:visible");
  await expect(action).toHaveAttribute("data-reading-action-state", "ready");
  return action.getByRole("button", { name: "Изучено", exact: true });
}
test("reading progress persists for a free non-member, reconciles lost responses and isolates Accounts", async ({ page, context, browser }, testInfo) => {
  await signIn(context);
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
  await expect(page.getByRole("alert")).toContainText("Не сохранено");
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
  await button.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(directory, `${testInfo.project.name}-reader.png`) });
  const accessibility = await new AxeBuilder({ page }).include("[data-reading-action-state]:visible").analyze();
  expect(accessibility.violations).toEqual([]);
  await page.goto("/library");
  const card = page.getByRole("article").filter({ has: page.getByRole("link", { name: "Как устроен Inside Platform", exact: true }) });
  await expect(card.locator("[data-material-reading-status]")).toHaveText("Изучено");
  await page.screenshot({ path: resolve(directory, `${testInfo.project.name}-library.png`) });
  const other = await browser.newContext();
  try {
    await signIn(other);
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
