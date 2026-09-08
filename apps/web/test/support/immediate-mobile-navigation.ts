import { expect, type Page } from "@playwright/test";

export async function expectImmediateMobileNavigation(page: Page) {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/account\?_rsc=/u, async (route) => {
    await held;
    await route.continue().catch(() => undefined);
  });
  await page.goto("/library");
  await expect(page.getByRole("searchbox")).toBeVisible();
  try {
    await page.getByRole("navigation", { name: "Мобильная навигация" }).getByRole("link", { name: "Профиль" }).click();
    await expect(page.getByRole("heading", { name: "Ваш профиль" })).toBeVisible({ timeout: 500 });
    await expect(page.getByRole("navigation", { name: "Мобильная навигация" }).getByRole("link", { name: "Профиль" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("searchbox")).not.toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByRole("heading", { name: "Войдите в аккаунт" })).toBeVisible();
}
