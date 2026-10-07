import { expect, test } from "@playwright/test";

import { signInFullStack } from "../support/full-stack-session";

// Продукт практики прогона перенесён из источника (`scripts/full-stack-practice.mjs`). Backend
// отклоняет запись его настроек и состава из редактора, и раньше после отказа автор не мог уйти
// со страницы без перезагрузки (#844).
test("imported product opens read-only in the editor and lets the author leave", async ({
  page,
  context,
}) => {
  await signInFullStack(context, "OWNER");
  const writes: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (request.method() !== "GET" && pathname.startsWith("/api/authoring/"))
      writes.push(`${request.method()} ${pathname}`);
  });

  await page.goto("/authoring/products");
  await page.getByRole("link", { name: /^Synthetic practice/u }).click();
  await expect(page).toHaveURL(/\/authoring\/products\/[a-f0-9-]{36}$/u);

  await expect(page.getByRole("note")).toContainText(
    "Продукт перенесён из источника.",
  );
  const composition = page.getByRole("list", { name: "Материалы продукта" });
  await expect(composition).toContainText("Synthetic practice reference");
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
