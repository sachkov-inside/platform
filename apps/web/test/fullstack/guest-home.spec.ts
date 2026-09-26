import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("guest Home without an author pin keeps the feed without subscription advertising", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#featured-title")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Подписка Inside" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Получить полный доступ", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("article").first()).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(
    scan.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath("guest-home.png"),
    animations: "disabled",
  });
});

test("tablet Home can scroll through the feed and keeps navigation usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/");
  const articles = page.getByRole("article");
  await expect(articles.first()).toBeVisible();
  const firstCount = await articles.count();
  await articles.last().scrollIntoViewIfNeeded();
  await expect.poll(() => articles.count()).toBeGreaterThan(firstCount);
  await expect(
    page
      .getByRole("navigation", { name: "Мобильная навигация" })
      .getByRole("link", { name: "Главная" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(768);
});

for (const width of [320, 768])
  test(`Home feed reflows at ${String(width)}px with doubled text`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    // The storage notice is fixed to the viewport and at doubled text covers the filters (#664).
    await page
      .getByRole("region", { name: "Хранение в браузере" })
      .getByRole("button", { name: "Понятно" })
      .click();
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    // The feed replaces its cards when the filter answers; measure the filtered cards, not the old ones.
    const filtered = page.waitForResponse(
      (response) =>
        response.url().includes("/api/home/materials?") &&
        response.url().includes("format=note"),
    );
    await page.getByRole("button", { name: "Заметки", exact: true }).click();
    await filtered;
    const note = page.getByRole("article").first();
    // The response resolves before React swaps the cards, so the first card can detach mid-scroll.
    await expect(async () => {
      await note.scrollIntoViewIfNeeded({ timeout: 1_000 });
      await expect(note).toBeInViewport({ timeout: 1_000 });
    }).toPass();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
