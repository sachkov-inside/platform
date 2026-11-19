import { expect, test } from "@playwright/test";

test("Back restores the reading position at the click that leaves for home", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Понятно", exact: true }).click();
  await page
    .locator('a[href*="/materials/navigation-lesson-2"]:visible')
    .first()
    .click();
  const body = page.locator("[data-reader-body]:visible");
  await expect(body).toBeVisible();
  const href = page.url();
  const link = page.getByRole("link", {
    name: /^sachkov\.dev(?:, Главная)?$/u,
  });
  const root = await body.evaluateHandle((node) => {
    const shell = node.closest<HTMLElement>("[data-application-content]");
    if (shell !== null && getComputedStyle(shell).overflowY === "auto")
      return shell;
    return document.documentElement;
  });
  const desired = await root.evaluate((node) => {
    const top = Math.floor((node.scrollHeight - node.clientHeight) / 2);
    node.scrollTo({ top, behavior: "instant" });
    return top;
  });
  expect(desired).toBeGreaterThan(0);
  await expect
    .poll(() => root.evaluate((node) => node.scrollTop))
    .toBe(desired);
  const atClick = root.evaluate(
    (node) =>
      new Promise<number>((resolve) => {
        document.addEventListener(
          "click",
          () => {
            resolve(node.scrollTop);
          },
          {
            capture: true,
            once: true,
          },
        );
      }),
  );
  await link.click();
  const position = await atClick;
  // Revealing the header link may move the mobile document before the click.
  if (!isMobile) expect(position).toBe(desired);
  await expect(page).toHaveURL(/\/$/u);
  await page.goBack();
  await expect(page).toHaveURL(href);
  await expect(body).toBeVisible();
  await expect
    .poll(() => root.evaluate((node) => node.scrollTop))
    .toBe(position);
});
