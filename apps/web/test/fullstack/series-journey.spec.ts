import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

test("series journey resumes the last opened guide and preserves the Reader return position", async ({ page, context }, testInfo) => {
  const name = process.env.FULLSTACK_LOGTO_COOKIE_NAME;
  const value = process.env.FULLSTACK_LOGTO_NON_MEMBER_SESSION;
  if (name === undefined || value === undefined) throw new Error("Missing local identity fixture");
  await context.addCookies([{ name, value, url: process.env.FULLSTACK_WEB_BASE_URL ?? "http://127.0.0.1:3000", httpOnly: true, sameSite: "Lax" }]);
  await page.addLocatorHandler(page.getByRole("button", { name: "Закрыть подключение Telegram" }), async (button) => { await button.click(); });
  for (const slug of ["demo-295-obshchiy-gayd", "demo-295-finalnyy-gayd"]) {
    const opened = page.waitForResponse((response) => response.url().endsWith("/api/reading-progress/open") && response.request().method() === "POST");
    await page.goto(`/materials/${slug}`);
    expect((await opened).ok()).toBe(true);
    const button = page.locator("[data-reading-action-state]:visible").getByRole("button", { name: "Изучено", exact: true });
    await expect(button).toBeVisible();
    if (await button.getAttribute("aria-pressed") === "true") { await button.click(); await expect(button).toHaveAttribute("aria-pressed", "false"); }
  }
  await page.goto("/series/demo-series-harness");
  const journey = page.getByRole("region", { name: "Прохождение серии" });
  await expect(journey.getByRole("progressbar")).toHaveAttribute("value", "0");
  const resume = journey.getByRole("link", { name: "Продолжить", exact: true });
  await expect(resume).toHaveAttribute("href", /demo-295-finalnyy-gayd/u);
  await journey.getByRole("button", { name: "Показать в маршруте" }).click();
  await expect(page).toHaveURL(/at=demo-295-finalnyy-gayd/u);
  await expect(page.locator('[data-series-ordinal="2"]')).toBeFocused();
  await page.reload();
  await expect(journey.getByRole("link", { name: "Продолжить", exact: true })).toHaveAttribute("href", /demo-295-finalnyy-gayd/u);
  await page.locator('[data-series-ordinal="2"]').getByRole("link", { name: "Demo #295 · Финальный гайд", exact: true }).click();
  await page.getByRole("link", { name: "Назад к серии", exact: true }).first().click();
  await expect(page).toHaveURL(/at=demo-295-finalnyy-gayd/u);
  await expect(page.locator('[data-series-ordinal="2"]')).toBeInViewport();
  await expect(page.getByRole("navigation", { name: "Страницы маршрута" })).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).include("[data-discovery-kind=series]").analyze();
  expect(accessibility.violations).toEqual([]);
  const directory = resolve(process.cwd(), "../../docs/evidence/issue-426");
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.screenshot({ path: resolve(directory, `live-${testInfo.project.name}.png`), fullPage: true });
  await context.clearCookies();
  await page.goto("/series/platform-inside");
  await expect(page.locator("[data-series-learning]")).toHaveAttribute("data-series-learning", "guest");
  await expect(page.locator("[data-series-access]").getByText("По подписке")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});
