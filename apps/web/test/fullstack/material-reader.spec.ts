import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("server-renders the representative PostgreSQL Material through Nest", async ({
  page,
  request,
}) => {
  const documentResponse = await request.get("/materials/inside-platform-overview");
  const initialHtml = await documentResponse.text();

  expect(documentResponse.status()).toBe(200);
  expect(initialHtml).toContain("Как устроен Inside Platform");
  expect(initialHtml).toContain("Первый вертикальный срез");

  const browserResponse = await page.goto("/materials/inside-platform-overview");
  expect(browserResponse?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Как устроен Inside Platform", level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Первый вертикальный срез", level: 2 }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Как устроен Inside Platform · Inside");
  await expect(page.getByRole("link", { name: "В Библиотеку" }).first()).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);

  const overflow = await page.locator("html").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test("returns the production not-found state for an unpublished slug", async ({ page }) => {
  await page.goto("/materials/not-published");

  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  await expect(page.getByRole("heading", { name: "Материал не найден" })).toBeVisible();
  await expect(page.getByRole("link", { name: "В Библиотеку" })).toBeVisible();
});
