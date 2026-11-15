import { expect, type Page } from "@playwright/test";

/** Wait for the signed-in Reader's open, refresh and personal controls before auditing. */
export async function expectReaderReadyForAudit(page: Page, title: string) {
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
  // Saving the open and refreshing the route do not settle the independent personal reads.
  // Once enabled, the buttons still fade from disabled opacity; axe must see the settled paint.
  for (const action of ["reading", "bookmark"]) {
    const attribute = `data-${action}-action-state`;
    const actions = openedReader.locator(`[${attribute}]:visible`);
    for (const control of await actions.all()) {
      await expect(control).not.toHaveAttribute(
        attribute,
        /^(loading|pending)$/u,
      );
      const button = control.locator('button:not([aria-disabled="true"]), a');
      if ((await button.count()) > 0)
        await expect(button).toHaveCSS("opacity", "1");
    }
  }
}
