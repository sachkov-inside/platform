import { expect, test } from "@playwright/test";

import { signInFullStack } from "../support/full-stack-session";

// Продукт практики прогона перенесён из источника (`scripts/full-stack-practice.mjs`). Backend
// отклоняет запись его настроек и состава из редактора, и раньше после отказа автор не мог уйти
// со страницы без перезагрузки (#844).
test("imported product opens read-only in the editor and lets the author leave", async ({
  page,
  context,
}) => {
  const productId = process.env["FULLSTACK_PRACTICE_PRODUCT_ID"];
  if (productId === undefined)
    throw new Error("Missing isolated imported Product fixture");
  await signInFullStack(context, "OWNER");
  const writes: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (request.method() !== "GET" && pathname.startsWith("/api/authoring/"))
      writes.push(`${request.method()} ${pathname}`);
  });

  await page.goto("/authoring/products");
  const product = page.locator(`a[href="/authoring/products/${productId}"]`);
  await expect(product).toHaveCount(1);
  await product.click();
  await expect(page).toHaveURL(`/authoring/products/${productId}`);

  await page
    .getByRole("tab", { name: "Описание и обложка", exact: true })
    .click();
  await expect(page.getByRole("note")).toContainText(
    "Продукт перенесён из источника.",
  );
  await page.getByRole("tab", { name: "Программа", exact: true }).click();
  const composition = page
    .getByRole("tabpanel", { name: "Программа", exact: true })
    .getByRole("list", { name: "Материалы главы «Практика»", exact: true });
  await expect(composition).toHaveCount(1);
  await expect(composition).toContainText(
    "Synthetic practice reference closed",
  );
  await expect(composition.getByRole("button")).toHaveCount(0);
  await expect(composition.getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Название продукта" }),
  ).toHaveCount(0);
  // «В архив» есть и у артефактов, поэтому архив продукта ищется в его навигации.
  await expect(
    page
      .getByRole("navigation", { name: "Навигация продукта" })
      .getByRole("button", { name: "В архив" }),
  ).toHaveCount(0);
  for (const name of ["Добавить главу", "Добавить материал"])
    await expect(page.getByRole("button", { name })).toHaveCount(0);

  await page.getByRole("button", { name: "Все продукты" }).click();
  await expect(page).toHaveURL(/\/authoring\/products$/u);
  expect(writes).toEqual([]);
});
