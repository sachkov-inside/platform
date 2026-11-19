import { expect, test } from "@playwright/test";

test("the mobile Home link follows query History and remembers the hidden Home route", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile-chromium");
  await page.goto("/");
  const feed = page.getByRole("region", { name: "Материалы", exact: true });
  await expect(feed.getByRole("status")).toHaveText(/Материалов: \d+/u);
  const home = page.locator("[data-mobile-header]").getByRole("link", {
    name: /^(?:sachkov\.dev, )?Главная$/u,
  });
  await expect(home).toHaveAttribute("href", "/");
  const filteredHome = "/?topic=navigation-topic";

  // The restored entry differs from both the last observed href and the pushed URL.
  await page.evaluate((destination) => {
    const traversed = new Promise<void>((resolve) => {
      window.addEventListener(
        "popstate",
        () => {
          resolve();
        },
        { once: true },
      );
    });
    window.history.replaceState(null, "", destination);
    window.history.pushState(null, "", "/");
    window.history.back();
    return traversed;
  }, filteredHome);
  await expect(page).toHaveURL(filteredHome);
  await expect(home).toHaveAttribute("href", filteredHome);
  await page.goForward();
  await expect(home).toHaveAttribute("href", "/");
  await page.goBack();
  await expect(home).toHaveAttribute("href", filteredHome);

  const retainedFeed = await feed.elementHandle();
  await page
    .getByRole("navigation", { name: "Мобильная навигация" })
    .getByRole("link", { name: "Закладки" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Войдите в аккаунт" }),
  ).toBeVisible();
  await expect(
    retainedFeed.evaluate(
      (node) => node.isConnected && node.getClientRects().length === 0,
    ),
  ).resolves.toBe(true);
  await expect(home).toHaveAttribute("href", filteredHome);
});
