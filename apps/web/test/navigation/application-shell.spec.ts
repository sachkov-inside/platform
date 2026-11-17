import { expect, test, type Page } from "@playwright/test";

async function scrollDocument(page: Page, top: number) {
  await page.evaluate(async (destination) => {
    if (window.scrollY === destination) return;
    const scrolled = Promise.withResolvers<undefined>();
    window.addEventListener(
      "scroll",
      () => {
        scrolled.resolve(undefined);
      },
      { once: true },
    );
    window.scrollTo({ top: destination, behavior: "instant" });
    await scrolled.promise;
  }, top);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(top);
}

test("public shell preserves the reading position when its actual scroll root changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/legal/terms");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const content = page.locator("[data-application-content]");
  await scrollDocument(page, 600);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect
    .poll(() => content.evaluate((element) => element.scrollTop))
    .toBe(600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await content.evaluate(async (element) => {
    const scrolled = Promise.withResolvers<undefined>();
    element.addEventListener(
      "scroll",
      () => {
        scrolled.resolve(undefined);
      },
      { once: true },
    );
    element.scrollTo({ top: 900, behavior: "instant" });
    await scrolled.promise;
  });
  await expect
    .poll(() => content.evaluate((element) => element.scrollTop))
    .toBe(900);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(900);
  await expect
    .poll(() => content.evaluate((element) => element.scrollTop))
    .toBe(0);
});

test("public mobile header follows scroll direction and remains reachable by focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/legal/terms");
  const header = page.locator("[data-mobile-header]");
  await expect(header).toBeVisible();
  await scrollDocument(page, 600);
  await expect
    .poll(() =>
      header.evaluate((element) => element.getBoundingClientRect().bottom),
    )
    .toBeLessThanOrEqual(0);
  await scrollDocument(page, 598);
  await expect
    .poll(() =>
      header.evaluate((element) => element.getBoundingClientRect().bottom),
    )
    .toBeLessThanOrEqual(0);
  await scrollDocument(page, 580);
  await expect
    .poll(() =>
      header.evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeGreaterThanOrEqual(0);
  await scrollDocument(page, 700);
  await expect
    .poll(() =>
      header.evaluate((element) => element.getBoundingClientRect().bottom),
    )
    .toBeLessThanOrEqual(0);
  const home = header.getByRole("link", { name: "sachkov.dev, Главная" });
  await home.evaluate((element) => {
    element.focus({ preventScroll: true });
  });
  await expect(home).toBeFocused();
  await expect
    .poll(() =>
      header.evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeGreaterThanOrEqual(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(700);
});
