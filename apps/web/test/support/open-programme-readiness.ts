import { expect, type Page } from "@playwright/test";

/** These fixtures open every Material and report unavailable progress after the browser read settles. */
export async function expectOpenProgrammeReady(page: Page, slug: string) {
  const programme = page.locator(`[data-product-programme="${slug}"]:visible`);
  await expect(
    programme.locator('[data-programme-part="header"]'),
  ).toContainText("всё открыто");
  await expect(
    programme.getByText(
      "Прогресс сейчас не загрузился. Материалы можно читать.",
      { exact: true },
    ),
  ).toBeVisible();
  return programme;
}
