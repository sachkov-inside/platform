import { chromium } from "@playwright/test";
import { test, expect } from "vitest";
import { expectReaderReadyForAudit } from "../support/reader-audit-readiness";

// These markers are the public DOM contract consumed by the audit helper. The fixture holds
// personal reads after the independent open/refresh facts, as a delayed HTTP response does.
for (const action of ["reading", "bookmark"]) {
  test(`Reader audit waits for the ${action} action's loaded and opaque control`, async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(`<title>Reader</title>
        <div data-route-refresh-pending="false">
          <div data-material-open-state="saved">
            <main data-material-reader-state="available">
              <div data-${action}-action-state="loading">
                <button aria-disabled="true" style="opacity:.5">Action</button>
              </div>
            </main>
          </div>
        </div>`);
      await page.evaluate((action) => {
        const control = document.querySelector("button");
        if (control === null) throw new Error("Missing action");
        // deterministic-test-allow duration-wait: model personal-read latency; the audit must observe the rendered result, not this timer.
        setTimeout(() => {
          control.setAttribute("aria-disabled", "false");
          control.parentElement?.setAttribute(
            `data-${action}-action-state`,
            "ready",
          );
          // The enabled control is still dimmed during its production opacity transition.
          control.animate([{ opacity: 0.5 }, { opacity: 1 }], {
            duration: 300,
          });
          control.style.opacity = "1";
        }, 100);
      }, action);
      await expectReaderReadyForAudit(page, "Reader");
      expect(await page.locator("button").getAttribute("aria-disabled")).toBe(
        "false",
      );
      expect(
        await page
          .locator("button")
          .evaluate((node) => getComputedStyle(node).opacity),
      ).toBe("1");
    } finally {
      await browser.close();
    }
  });
}
