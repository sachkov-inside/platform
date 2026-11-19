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
  await page.waitForFunction(() => {
    const state: unknown = history.state;
    if (
      state === null ||
      typeof state !== "object" ||
      !("insideReader" in state)
    )
      return false;
    const entry = state.insideReader;
    return (
      entry !== null &&
      typeof entry === "object" &&
      "href" in entry &&
      entry.href === location.href
    );
  });

  const root = () =>
    page.locator(isMobile ? "html" : "[data-application-content]:visible");
  const desired = await root().evaluate((node) => {
    const top = Math.floor((node.scrollHeight - node.clientHeight) / 2);
    node.scrollTo({ top, behavior: "instant" });
    return top;
  });
  expect(desired).toBeGreaterThan(0);
  const position = () => root().evaluate((node) => node.scrollTop);
  await expect.poll(position).toBe(desired);
  const atClick = root().evaluate(
    (node) =>
      new Promise<number>((resolve) => {
        document.addEventListener(
          "click",
          () => {
            resolve(node.scrollTop);
          },
          { capture: true, once: true },
        );
      }),
  );
  await page
    .getByRole("link", { name: /^sachkov\.dev(?:, Главная)?$/u })
    .click();
  const departure = await atClick;
  if (!isMobile) expect(departure).toBe(desired);

  await expect(page).toHaveURL(/\/$/u);
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
  // Keep the two pages distinguishable even if revealing the mobile header moved the document.
  const home = await root().evaluate((node) => {
    const top = node.scrollHeight - node.clientHeight;
    node.scrollTo({ top, behavior: "instant" });
    return top;
  });
  expect(home).not.toBe(departure);
  await expect.poll(position).toBe(home);
  await page.goBack();
  await expect(page).toHaveURL(href);
  await expect(body).toBeVisible();
  await expect.poll(position).toBe(departure);
});
