import { expectImmediateMobileNavigation } from "../support/immediate-mobile-navigation";
import { expect, test } from "@playwright/test";

test("mobile navigation keeps real catalog context and public canvas", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  await page.goto("/?format=guide");
  await expect(page.getByRole("list", { name: "Материалы, страница 1" })).toBeVisible();
  await page.evaluate(() => { window.scrollTo(0, 600); });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
  const navigation = page.getByRole("navigation", { name: "Мобильная навигация" });
  const response = page.waitForResponse((value) => new URL(value.url()).pathname === "/api/account");
  await navigation.getByRole("link", { name: "Профиль" }).click();
  expect((await response).status()).toBe(401);
  await expect(page.getByRole("heading", { name: "Войдите в аккаунт" })).toBeVisible();
  await navigation.getByRole("link", { name: "Главная" }).click();
  await expect(page).toHaveURL(/\/\?format=guide$/u);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
  await expect(page.getByRole("button", { name: "Гайды", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
});


test("mobile navigation public route evidence", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Материалы, страница 1" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  await testInfo.attach("library-public-route", { body: await page.screenshot(), contentType: "image/png" });
});

test("mobile navigation stays mounted without fading the document during tab changes", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Материалы, страница 1" })).toBeVisible();
  const observation = page.evaluate(async () => {
    const navigation = document.querySelector('nav[aria-label="Мобильная навигация"]');
    if (navigation === null) throw new Error("Mobile navigation is missing");
    const top = navigation.getBoundingClientRect().top;
    const failures = new Set<string>();
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const sample = () => {
        if (!navigation.isConnected) failures.add("navigation unmounted");
        const style = getComputedStyle(navigation);
        if (style.visibility !== "visible" || Number(style.opacity) < 1) failures.add("navigation hidden");
        if (Math.abs(navigation.getBoundingClientRect().top - top) > 1) failures.add("navigation moved");
        for (const animation of document.getAnimations()) {
          if (animation instanceof CSSAnimation && /public-page-fade|view-transition/u.test(animation.animationName)) {
            failures.add(animation.animationName);
          }
        }
        if (performance.now() - started < 1_000) requestAnimationFrame(sample);
        else resolve();
      };
      sample();
    });
    return [...failures];
  });
  await page.getByRole("navigation", { name: "Мобильная навигация" }).getByRole("link", { name: "Профиль" }).click();
  await expect(page.getByRole("heading", { name: "Войдите в аккаунт" })).toBeVisible();
  expect(await observation).toEqual([]);
});

test("home notes are readable posts with dates and a format filter", async ({ page }, testInfo) => {
  await page.goto("/?format=note");
  const notes = page.getByRole("region", { name: "Материалы", exact: true });
  await expect(page.getByRole("button", { name: "Заметки", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(notes.locator("time").first()).toHaveAttribute("datetime", /T/u);
  await expect(notes.locator("[inert]")).toHaveCount(0);
  await expect(notes.getByRole("article").first().locator(".home-feed-post-copy")).not.toBeEmpty();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
  await page.screenshot({ path: testInfo.outputPath("home-notes.png"), animations: "disabled" });
});


test("mobile navigation displays a cold destination before the server responds", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"));
  await expectImmediateMobileNavigation(page);
});

test("the retired knowledge base has no route or navigation entry", async ({ page, request }) => {
  expect((await request.get("/library", { maxRedirects: 0 })).status()).toBe(404);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "База знаний", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Что даёт подписка" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Материалы", exact: true })).toBeVisible();
});
