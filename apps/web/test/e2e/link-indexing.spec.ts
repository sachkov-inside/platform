import { expect, test } from "@playwright/test";

const CLOSED_SECTIONS = [
  "/_health/",
  "/account",
  "/api/",
  "/auth/",
  "/authoring",
  "/bookmarks",
  "/callback",
  "/communications/visit",
  "/subscription/return",
];

test("robots.txt закрывает служебные разделы и называет карту сайта", async ({
  baseURL,
  request,
}) => {
  const response = await request.get("/robots.txt");

  expect(response.status()).toBe(200);
  const body = await response.text();
  for (const section of CLOSED_SECTIONS) {
    expect(body).toContain(`Disallow: ${section}`);
  }
  expect(body).toContain("Allow: /");
  expect(body).toContain(`Sitemap: ${String(baseURL)}/sitemap.xml`);
});

test("карта сайта остаётся рабочей, когда каталог недоступен", async ({
  baseURL,
  request,
}) => {
  const response = await request.get("/sitemap.xml");

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain(`<loc>${String(baseURL)}/</loc>`);
  expect(body).toContain(`<loc>${String(baseURL)}/library</loc>`);
});

test.describe("Закрытые от индексации разделы", () => {
  for (const path of ["/account", "/account/purchases", "/authoring/materials", "/bookmarks"]) {
    test(`${path} не индексируется`, async ({ page }) => {
      await page.goto(path);

      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        /noindex/u,
      );
    });
  }
});

test("недоступная страница материала не зовёт поиск на пустую карточку", async ({
  page,
}) => {
  await page.goto("/materials/kak-ustroen-inside-platform");

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/u,
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});
