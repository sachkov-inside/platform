import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("guest Home uses published series and the existing acquisition route", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-home-membership="inactive"]')).toBeVisible();
  const title = await page.locator("#featured-title").innerText();
  const seriesLink = page.getByRole("link", { name: "Изучить серию" });
  await expect(seriesLink).toHaveAttribute("href", /^\/series\/[^?]+\?from=%2F$/u);
  const offer = page.getByRole("region", { name: "Подписка Inside" });
  await expect(offer.getByRole("link", { name: "Полный доступ", exact: true })).toHaveAttribute("href", /^https?:\/\//u);
  expect(await offer.evaluate((element) => Boolean(element.compareDocumentPosition(document.querySelector('[aria-labelledby="home-videos"]') as Node) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.getByRole("heading", { name: "Все материалы в одном каталоге" })).toHaveCount(0);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("guest-home.png"), animations: "disabled" });
  await seriesLink.click();
  await expect(page.getByRole("heading", { name: title, exact: true, level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/series\//u);
});

test("tablet Home can scroll to the last section and keeps navigation usable", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/");
  await page.mouse.wheel(0, 20_000);
  await expect(page.getByRole("link", { name: "Получить полный доступ", exact: true })).toBeInViewport();
  await expect(page.getByRole("navigation", { name: "Мобильная навигация" }).getByRole("link", { name: "База знаний" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
});
