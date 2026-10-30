import type { Page } from "@playwright/test";

/** Approach the current programme row so the real infinite reveal can observe it. */
export async function scrollProgrammeBoundaryIntoView(
  page: Page,
  ordinal: number,
): Promise<void> {
  // A refresh may replace a row while Playwright waits for its geometry to settle.
  // Resolve the live row and scroll in one browser turn under the persistent shell.
  await page
    .locator("[data-application-content]")
    .evaluate((shell, ordinal) => {
      const row = [
        ...shell.querySelectorAll<HTMLElement>(
          `[data-product-ordinal="${String(ordinal)}"]`,
        ),
      ].find((candidate) => candidate.getClientRects().length > 0);
      if (row === undefined)
        throw new Error(`Programme row ${String(ordinal)} missing`);
      row.scrollIntoView({ block: "center", behavior: "instant" });
    }, ordinal);
}
