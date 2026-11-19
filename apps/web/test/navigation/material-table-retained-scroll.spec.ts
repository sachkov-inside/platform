import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 900 } });

test("a retained reader table keeps the reader's horizontal position on successive history returns", async ({
  page,
}) => {
  const path = "/materials/table-names-single";
  await page.goto(path);
  await page.getByRole("button", { name: "Понятно", exact: true }).click();
  const region = page.getByRole("region", {
    name: "Таблица в материале",
    exact: true,
  });
  const viewport = await region.elementHandle();
  const table = await region.getByRole("table").elementHandle();
  await region.focus();
  await region.evaluate((node) => {
    node.scrollLeft = node.scrollWidth;
  });
  const end = await region.evaluate(
    (node) => node.scrollWidth - node.clientWidth,
  );
  expect(end).toBeGreaterThan(0);

  async function checkReturn(left: number) {
    await expect
      .poll(() => region.evaluate((node) => node.scrollLeft))
      .toBe(left);
    await page
      .getByRole("navigation", { name: "Действия материала" })
      .getByRole("link", { name: "Назад", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Главная", exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(path);
    await expect(region).toBeVisible();
    await expect(
      region.evaluate((current, previous) => current === previous, viewport),
    ).resolves.toBe(true);
    await expect(
      region
        .getByRole("table")
        .evaluate((current, previous) => current === previous, table),
    ).resolves.toBe(true);
    await expect
      .poll(() => region.evaluate((node) => node.scrollLeft))
      .toBe(left);
  }
  await checkReturn(end);
  await checkReturn(end);
  await region.evaluate((node) => {
    node.scrollLeft = 0;
  });
  await checkReturn(0);
});
