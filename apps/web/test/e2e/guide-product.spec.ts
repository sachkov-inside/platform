import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const product = "/guides/platform-inside";
const programme = `${product}/programme`;

test("страница продукта отвечает и не продаёт", async ({ page }) => {
  const response = await page.goto(product);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Продажа целиком уехала в программу: со страницы продукта купить нельзя.
  await expect(page.getByRole("link", { name: /Оплатить сейчас/u })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Купить за/u })).toHaveCount(0);
});

test("программа отвечает по обоим адресам руководства", async ({ page }) => {
  const first = await page.goto(programme);
  expect(first?.status()).toBe(200);

  const second = await page.goto("/series/platform-inside/programme");
  expect(second?.status()).toBe(200);
});

test("страница продукта не имеет серьёзных нарушений доступности", async ({
  page,
}) => {
  await page.goto(product);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(
    results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
});

test("программа не имеет серьёзных нарушений доступности", async ({ page }) => {
  await page.goto(programme);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(
    results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
});
