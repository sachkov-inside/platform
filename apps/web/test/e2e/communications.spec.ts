import { expect, test } from "@playwright/test";

for (const path of [
  "/authoring/communications",
  "/authoring/communications/broadcasts",
]) {
  test(`Telegram management is absent from Platform: ${path}`, async ({
    page,
  }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Воронки|Рассылки/u }),
    ).toHaveCount(0);
  });
}
