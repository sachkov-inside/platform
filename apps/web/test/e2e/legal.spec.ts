import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** Раздел открыт без входа и без оплаты: посетитель читает условия до любой формы. */
test("юридический раздел перечисляет действующие документы", async ({ page }) => {
  const response = await page.goto("/legal");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Документы Inside");
  await expect(
    page.getByRole("link", { name: /Условия использования Inside/u }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Оферта разовой покупки/u }).first()).toBeVisible();
  await expect(page.getByText(/ИНН 771004514845/u).first()).toBeVisible();
});

test("документ открывается по своему адресу и называет редакцию", async ({ page }) => {
  const response = await page.goto("/legal/terms");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Условия использования Inside",
  );
  await expect(page.getByText("Действует с 12 сентября 2026 года").first()).toBeVisible();
  await expect(page.getByText(/^[0-9a-f]{64}$/u)).toBeVisible();
});

test("адрес редакции остаётся рабочим и не спорит с действующим текстом", async ({
  page,
}) => {
  const response = await page.goto("/legal/terms/v1");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Условия использования Inside",
  );
  await expect(page.getByRole("link", { name: "/legal/terms/v1" })).toBeVisible();
});

test("неизвестный документ отвечает 404, а не пустой страницей", async ({ page }) => {
  const response = await page.goto("/legal/facts-and-applicability");

  expect(response?.status()).toBe(404);
});

test("футер ведёт к документам с любой публичной страницы", async ({ page }) => {
  // Страница «Карта» не зависит от каталога, поэтому проверяет именно футер оболочки.
  await page.goto("/map");

  const footer = page.getByRole("navigation", { name: "Документы Inside" });
  await expect(footer.getByRole("link", { name: "Политика данных" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Реквизиты и обращения" })).toBeVisible();
  await footer.getByRole("link", { name: "Cookies и хранение" }).click();
  await expect(page).toHaveURL(/\/legal\/cookies$/u);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Cookies и локальное хранение в Inside",
  );
});

for (const path of ["/legal", "/legal/privacy"]) {
  test(`${path} не имеет серьёзных замечаний доступности`, async ({ page }) => {
    await page.goto(path);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const materialViolations = results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );

    expect(materialViolations).toEqual([]);
  });
}
