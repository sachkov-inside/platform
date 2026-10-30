import { expect, type Page } from "@playwright/test";

/**
 * Wait for the persistent course frame when a test needs to exercise route-to-route ownership.
 * Early user interactions are covered separately by the gated host handoff browser regression (#1824).
 */
export async function expectCourseReadingHost(page: Page) {
  await expect(page.locator("[data-course-reading-host]")).toBeVisible();
}
