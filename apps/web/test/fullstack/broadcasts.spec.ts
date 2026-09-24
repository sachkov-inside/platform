import { expect, test } from "@playwright/test";

test("Telegram management remains outside the Platform editor: /authoring/communications/broadcasts", async ({
  page,
}) => {
  await page.goto("/authoring/communications/broadcasts");
  await expect(page.getByRole("heading", { level: 1, name: "Страница не найдена" })).toBeVisible();
});
