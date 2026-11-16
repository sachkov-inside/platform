import { expect, test } from "@playwright/test";

test("the shared populated Product keeps main lessons and practice separate from extra material", async ({
  page,
}) => {
  await page.goto("/products/synthetic-learning/programme");
  await expect(
    page.getByRole("heading", {
      name: "Учебный курс: от идеи к выпуску",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Учебный пример: работа над проектом/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Учебный пример: покажи результат/ }),
  ).toBeVisible();
  await expect(page.locator("[data-product-ordinal]")).toHaveCount(3);
  await page
    .getByRole("navigation", { name: "Разделы продукта" })
    .getByRole("button", { name: /Материалы/ })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Материалы курса" })
      .getByRole("list")
      .last()
      .getByRole("listitem"),
  ).toHaveCount(4);
});
