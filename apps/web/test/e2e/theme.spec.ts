import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Тёмная тема (решение владельца 21.11.2026, #2516): кнопка в шапке выбирает «Светлая», «Тёмная» или
 * «Как в системе», выбор живёт в браузере, без выбора сайт светлый. Юридический раздел открыт без
 * входа и без backend, поэтому проверка идёт на нём.
 */
const storageKey = "inside.theme.v1";
const darkBackground = "rgb(24, 25, 27)";

test.beforeEach(async ({ page }) => {
  await page.route("**/auth/status", (route) =>
    route.fulfill({
      json: { state: "guest", canManageMaterials: false, accountId: null },
    }),
  );
});

async function chooseTheme(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { name: "Тема оформления" }).click();
  await page.getByRole("menuitemradio", { name: label }).click();
}

const bodyBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("без выбора сайт светлый, даже если система тёмная", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/legal");

  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/u);
  expect(await bodyBackground(page)).toBe("rgb(255, 255, 255)");
});

test("тёмная тема из шапки сохраняется после перезагрузки", async ({
  page,
}) => {
  await page.goto("/legal");
  await chooseTheme(page, "Тёмная");

  await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
  expect(await bodyBackground(page)).toBe(darkBackground);

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
  // One tag: the browser chrome on a phone takes the dark page colour.
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#18191b",
  );
  await page.getByRole("button", { name: "Тема оформления" }).click();
  await expect(
    page.getByRole("menuitemradio", { name: "Тёмная" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("сохранённая тёмная тема видна до загрузки скриптов приложения", async ({
  page,
}) => {
  // Без бандлов приложения тему может поставить только встроенный скрипт в <head>: так видно,
  // что страница не рисуется сначала светлой.
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await page.addInitScript((key) => {
    localStorage.setItem(key, "dark");
  }, storageKey);
  await page.goto("/legal");

  await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
  expect(await bodyBackground(page)).toBe(darkBackground);
});

test("«Как в системе» следует за системой, пока страница открыта", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/legal");
  await chooseTheme(page, "Как в системе");
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/u);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/u);
});

test("в тёмной теме текст держит контраст WCAG AA", async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, "dark");
  }, storageKey);
  for (const path of ["/legal", "/legal/terms"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const audit = await new AxeBuilder({ page })
      .withRules(["color-contrast"])
      .analyze();
    expect(audit.violations, path).toEqual([]);
  }
});

test("«не найдено» из раскладки админки тоже тёмная", async ({ page }) => {
  // Гость в админке получает «не найдено» ещё до оболочки: документ приходит без встроенного
  // скрипта темы, и страницу рисует клиент. Тему применяет кнопка в шапке этой страницы.
  await page.addInitScript((key) => {
    localStorage.setItem(key, "dark");
  }, storageKey);
  await page.goto("/authoring");

  await expect(
    page.getByRole("heading", { level: 1, name: "Страница не найдена" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
  expect(await bodyBackground(page)).toBe(darkBackground);
});
