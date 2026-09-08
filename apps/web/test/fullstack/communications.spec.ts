import { expect, test } from "@playwright/test";

test("Telegram management remains outside the Platform editor: /authoring/communications", async ({
  page,
}) => {
  await page.goto("/authoring/communications");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
});
