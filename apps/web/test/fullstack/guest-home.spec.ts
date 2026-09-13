import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("guest Home without an author pin keeps the feed without subscription advertising", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#featured-title")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Подписка Inside" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Получить полный доступ", exact: true })).toHaveCount(0);
  await expect(page.getByRole("article").first()).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("guest-home.png"), animations: "disabled" });
});

test("tablet Home can scroll through the feed and keeps navigation usable", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/");
  const articles = page.getByRole("article");
  await expect(articles.first()).toBeVisible();
  const firstCount = await articles.count();
  await articles.last().scrollIntoViewIfNeeded();
  await expect.poll(() => articles.count()).toBeGreaterThan(firstCount);
  await expect(page.getByRole("navigation", { name: "Мобильная навигация" }).getByRole("link", { name: "Главная" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
});

for (const width of [320, 768]) test(`Home feed reflows at ${String(width)}px with doubled text`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await page.getByRole("button", { name: "Заметки", exact: true }).click();
  const note = page.getByRole("article").first();
  await note.scrollIntoViewIfNeeded();
  await expect(note).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
