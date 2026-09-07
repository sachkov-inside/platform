import { expect, test } from "@playwright/test";

test("mobile navigation keeps real catalog context and public canvas", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  await page.goto("/library?format=guide");
  await expect(page.getByRole("list", { name: "Материалы, страница 1" })).toBeVisible();
  await page.evaluate(() => { window.scrollTo(0, 600); });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
  const navigation = page.getByRole("navigation", { name: "Мобильная навигация" });
  const response = page.waitForResponse((value) => new URL(value.url()).pathname === "/api/account");
  await navigation.getByRole("link", { name: "Профиль" }).click();
  expect((await response).status()).toBe(401);
  await expect(page.getByRole("heading", { name: "Войдите в аккаунт" })).toBeVisible();
  await navigation.getByRole("link", { name: "База знаний" }).click();
  await expect(page).toHaveURL(/\/library\?format=guide$/u);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
  await expect(page.getByRole("radio", { name: /Гайды/u })).toBeChecked();
  await navigation.getByRole("link", { name: "Главная" }).click();
  await expect(page.getByRole("heading", { name: "Главная", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Серии", exact: true })).toBeVisible();
  await navigation.getByRole("link", { name: "База знаний" }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
});
