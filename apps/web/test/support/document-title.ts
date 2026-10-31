import { expect, type Page } from "@playwright/test";

/** Wait for the visible signed-in Reader's open and its route refresh before auditing metadata. */
export async function expectDocumentTitle(page: Page, title: string) {
  const openedReader = page.locator("[data-material-open-state]").filter({
    has: page.locator('[data-material-reader-state="available"]:visible'),
  });
  await expect(openedReader).toHaveAttribute(
    "data-material-open-state",
    "saved",
  );
  await expect(
    page.locator("[data-route-refresh-pending]").filter({ has: openedReader }),
  ).toHaveAttribute("data-route-refresh-pending", "false");
  await expect(page).toHaveTitle(title);
}
