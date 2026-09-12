import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("guest Home without an author pin keeps the catalog and starts the purchase inside the platform", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-home-membership="inactive"]:visible')).toBeVisible();
  await expect(page.locator("#featured-title")).toHaveCount(0);
  const offer = page.getByRole("region", { name: "Подписка Inside" });
  // Призыв к покупке ведёт на внутреннюю витрину, а не на внешний сервис в новой вкладке.
  const fullAccess = offer.getByRole("link", { name: "Полный доступ", exact: true });
  await expect(fullAccess).toHaveAttribute("href", "/subscription");
  await expect(fullAccess).not.toHaveAttribute("target", /.*/u);
  await expect(page.getByRole("link", { name: "Получить полный доступ", exact: true })).toHaveAttribute("href", "/subscription");
  expect(await offer.evaluate((element) => Boolean(element.compareDocumentPosition(document.querySelector('[aria-labelledby="home-videos"]') as Node) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.getByRole("heading", { name: "Все материалы в одном каталоге" })).toHaveCount(0);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("guest-home.png"), animations: "disabled" });
});

test("tablet Home can scroll to the last section and keeps navigation usable", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/");
  const finalLink = page.getByRole("link", { name: "Получить полный доступ", exact: true });
  await expect(finalLink).toBeVisible();
  await expect.poll(async () => {
    await page.mouse.wheel(0, 20_000);
    return finalLink.evaluate((element) => element.getBoundingClientRect().bottom <= innerHeight);
  }).toBe(true);
  await expect(finalLink).toBeInViewport();
  await expect(page.getByRole("navigation", { name: "Мобильная навигация" }).getByRole("link", { name: "База знаний" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
});

for (const width of [320, 768]) test(`guest offers and notes reflow at ${String(width)}px with doubled text`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  const link = page.getByRole("link", { name: "Получить полный доступ", exact: true });
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
