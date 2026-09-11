import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const guide = "/guides/platform-inside";
const purchase = `${guide}/buy`;

test("витрина руководства отвечает и объясняет недоступность цены", async ({
  page,
}) => {
  const response = await page.goto(purchase);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Руководство",
  );
  // Возврат из банка не единственный честный предел: цена тоже приходит с сервера.
  await expect(page.getByRole("status")).toContainText(
    "Цена сейчас недоступна",
  );
});

test("витрина руководства возвращает к самому руководству", async ({ page }) => {
  await page.goto(purchase);

  await expect(
    page.getByRole("link", { name: "Вернуться к руководству" }),
  ).toHaveAttribute("href", guide);
});

test("оба адреса руководства ведут на одну витрину покупки", async ({
  page,
}) => {
  const response = await page.goto("/series/platform-inside/buy");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Руководство",
  );
});

test("витрина руководства не имеет серьёзных нарушений доступности", async ({
  page,
}) => {
  await page.goto(purchase);

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
