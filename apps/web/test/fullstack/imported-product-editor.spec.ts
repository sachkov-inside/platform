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

  await page.goto("/authoring/guides");
  await page.getByRole("link", { name: /^Synthetic practice/u }).click();
  await expect(page).toHaveURL(/\/authoring\/guides\/[a-f0-9-]{36}$/u);

  await expect(page.getByRole("note")).toContainText(
    "Продукт перенесён из источника.",
  );
  await expect(
    page.getByRole("list", { name: "Материалы продукта" }),
  ).toContainText("Synthetic practice reference");
  await expect(
    page.getByRole("textbox", { name: "Название продукта" }),
  ).toHaveCount(0);
  for (const name of ["В архив", "Добавить главу", "Добавить материал"])
    await expect(page.getByRole("button", { name })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Убрать «/u })).toHaveCount(0);

  await page.getByRole("button", { name: "Все продукты" }).click();
  await expect(page).toHaveURL(/\/authoring\/guides$/u);
  expect(writes).toEqual([]);
});
