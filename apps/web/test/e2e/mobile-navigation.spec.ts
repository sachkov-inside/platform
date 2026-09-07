import { expectImmediateMobileNavigation } from "../support/immediate-mobile-navigation";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const catalog = {
  kind: "ready",
  facets: { formats: [], series: [], topics: [] },
  items: Array.from({ length: 18 }, (_, index) => ({
    access: "free", availability: "available", format: "Гайд", formatSlug: "guide",
    seriesMemberships: [], slug: `navigation-${String(index)}`, summary: "Материал для проверки возврата к чтению.",
    tags: [], title: `Навигация ${String(index + 1)}`, topic: "Platform", topicSlug: "platform",
  })),
  nextCursor: null,
  totalCount: 18,
};

function navigation(page: Page) {
  return page.getByRole("navigation", { name: "Мобильная навигация" });
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  await page.route("**/auth/status", (route) => route.fulfill({ json: { state: "guest", canManageMaterials: false, accountId: null } }));
  await page.route("**/api/account", (route) => route.fulfill({ status: 401, json: { kind: "unauthorized" } }));
});

test("root tabs restore Library URL and scroll without a second loading screen", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/library/materials**", (route) => { requests++; return route.fulfill({ json: catalog }); });
  await page.goto("/library?q=навигация");
  await expect(page.getByRole("heading", { name: "Навигация 1", exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveValue("навигация");
  await page.evaluate(() => { window.scrollTo(0, 700); });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(700);
  await navigation(page).getByRole("link", { name: "Профиль" }).click();
  await expect(page.getByRole("heading", { name: "Войдите в аккаунт" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const loadedRequests = requests;
  await expect(navigation(page).getByRole("link", { name: "База знаний" })).toHaveAttribute("href", /q=/u);
  await navigation(page).getByRole("link", { name: "База знаний" }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("навигация");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(700);
  await expect(page.getByText("Загружаем опубликованные материалы")).toHaveCount(0);
  expect(requests).toBe(loadedRequests);
  await page.goBack();
  await expect(page).toHaveURL(/\/account$/u);
  await expect(navigation(page).getByRole("link", { name: "Профиль" })).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(page.getByRole("searchbox")).toHaveValue("навигация");
});

test("Library data is prefetched before the first tab visit", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/library/materials**", (route) => { requests++; return route.fulfill({ json: catalog }); });
  await page.goto("/account");
  await expect.poll(() => requests).toBe(1);
  await navigation(page).getByRole("link", { name: "База знаний" }).click();
  await expect(page.getByRole("heading", { name: "Навигация 1", exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test("fast repeated navigation remains clickable during the transition", async ({ page }) => {
  await page.route("**/api/library/materials**", (route) => route.fulfill({ json: catalog }));
  await page.goto("/library");
  await expect(page.getByRole("searchbox")).toBeVisible();
  // Real pointer input bypasses Playwright's animation-stability wait, as a quick user tap does.
  const profile = await navigation(page).getByRole("link", { name: "Профиль" }).boundingBox();
  if (profile === null) throw new Error("Profile link is missing");
  await page.mouse.click(profile.x + profile.width / 2, profile.y + profile.height / 2);
  await expect(page).toHaveURL(/\/account$/u);
  const library = await navigation(page).getByRole("link", { name: "База знаний" }).boundingBox();
  if (library === null) throw new Error("Library link is missing");
  await page.mouse.click(library.x + library.width / 2, library.y + library.height / 2);
  await expect(page).toHaveURL(/\/library$/u);
  await expect(navigation(page).getByRole("link", { name: "База знаний" })).toHaveAttribute("aria-current", "page");
});

test("public canvas, navigation geometry and reduced motion are consistent", async ({ page }) => {
  await page.route("**/api/library/materials**", (route) => route.fulfill({ json: catalog }));
  await page.goto("/account");
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const before = await navigation(page).boundingBox();
    await navigation(page).getByRole("link", { name: "База знаний" }).click();
    await expect(page.getByRole("searchbox")).toBeVisible();
    const after = await navigation(page).boundingBox();
    expect(after?.width).toBe(before?.width);
    expect(after?.y).toBe(before?.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await navigation(page).getByRole("link", { name: "Профиль" }).click();
  }
  expect(await page.locator('meta[name="theme-color"]').getAttribute("content")).toBe("#ffffff");
  expect(await page.evaluate(() => [document.documentElement, document.body].map((element) => getComputedStyle(element).backgroundColor))).toEqual(["rgb(255, 255, 255)", "rgb(255, 255, 255)"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await page.locator(".mobile-navigation-indicator").evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
  expect((await new AxeBuilder({ page }).include(".mobile-navigation").analyze()).violations).toEqual([]);
});

test("background Profile failure retains data but lost authorization removes it", async ({ page }) => {
  let accountStatus = 200;
  let requests = 0;
  await page.route("**/api/account", (route) => {
    requests++;
    return route.fulfill({ status: accountStatus, json: {
      profile: { kind: "missing" },
      telegramMembership: { link: { kind: "linked" }, membership: { kind: "stale" } },
    } });
  });
  await page.route("**/api/library/materials**", (route) => route.fulfill({ json: catalog }));
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Ваш профиль" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Выйти из аккаунта" })).toBeVisible();
  for (const status of [503, 401]) {
    accountStatus = status;
    const before = requests;
    await page.getByRole("button", { name: "Обновить доступ" }).click();
    await expect.poll(() => requests).toBeGreaterThan(before);
    if (status === 503) {
      await expect(page.getByRole("button", { name: "Выйти из аккаунта" })).toBeVisible();
      await expect(page.getByText("Account временно недоступен")).toHaveCount(0);
    } else {
      await expect(page.getByRole("heading", { name: "Войдите в аккаунт" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Выйти из аккаунта" })).toHaveCount(0);
    }
  }
});


test("native Back preserves the latest Library filter and scroll for the next tab visit", async ({ page }) => {
  await page.route("**/api/library/materials**", (route) => route.fulfill({ json: catalog }));
  await page.goto("/account");
  await navigation(page).getByRole("link", { name: "База знаний" }).click();
  await page.getByRole("searchbox").fill("навигация");
  await expect(page).toHaveURL(/q=/u);
  await expect(page.getByRole("heading", { name: "Навигация 1", exact: true })).toBeVisible();
  await page.getByRole("searchbox").blur();
  await page.evaluate(() => { window.scrollTo(0, 700); });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(700);
  await page.goBack();
  await expect(page).toHaveURL(/\/account$/u);
  await navigation(page).getByRole("link", { name: "База знаний" }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("навигация");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(700);
});

test("a newer tab selection wins over an unfinished route request", async ({ page }) => {
  await page.route("**/api/library/materials**", (route) => route.fulfill({ json: catalog }));
  await page.goto("/library");
  await expect(page.getByRole("searchbox")).toBeVisible();
  let started = false;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/account\?_rsc=/u, async (route) => {
    started = true;
    await held;
    await route.continue().catch(() => undefined);
  });
  try {
    await navigation(page).getByRole("link", { name: "Профиль" }).click();
    await expect.poll(() => started).toBe(true);
    await expect(page).toHaveURL(/\/library$/u);
    await navigation(page).getByRole("link", { name: "Главная" }).click();
    await expect(page).toHaveURL(/\/$/u);
  } finally {
    release();
  }
  await expect(navigation(page).getByRole("link", { name: "Главная" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Войдите в аккаунт" })).toHaveCount(0);
});

test("changing account identity clears remembered tabs and the old Profile form", async ({ page }) => {
  let accountId = "11111111-1111-4111-8111-111111111111";
  let accountRequests = 0;
  await page.route("**/auth/status", (route) => route.fulfill({ json: { state: "authenticated", canManageMaterials: false, accountId } }));
  await page.route("**/api/account", (route) => {
    accountRequests++;
    return route.fulfill({ json: {
      profile: { kind: "missing" },
      telegramMembership: { link: { kind: "linked" }, membership: { kind: "active" } },
    } });
  });
  await page.route("**/api/library/materials**", (route) => route.fulfill({ json: catalog }));
  await page.goto("/library?q=навигация");
  await expect(page.getByRole("searchbox")).toHaveValue("навигация");
  await navigation(page).getByRole("link", { name: "Профиль" }).click();
  const name = page.getByRole("textbox", { name: "Имя", exact: true });
  await name.fill("Старый аккаунт");
  await expect(navigation(page).getByRole("link", { name: "База знаний" })).toHaveAttribute("href", /q=/u);
  const before = accountRequests;
  accountId = "22222222-2222-4222-8222-222222222222";
  await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
  await expect.poll(() => accountRequests).toBeGreaterThan(before);
  await expect(name).toHaveValue("");
  await expect(navigation(page).getByRole("link", { name: "База знаний" })).toHaveAttribute("href", "/library");
});

test("a cold tab shows its destination immediately while the route response is still pending", async ({ page }) => {
  await page.route("**/api/library/materials**", (route) => route.fulfill({ json: catalog }));
  await expectImmediateMobileNavigation(page);
});
