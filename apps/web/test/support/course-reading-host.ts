import { expect, type Page } from "@playwright/test";

/**
 * After hydration the persistent host takes over the course rail and programme dialog and mounts
 * them anew (#1804, #1824): a control read or opened before that handoff belongs to the replaced copy.
 */
export async function expectCourseReadingHost(page: Page) {
  await expect(page.locator("[data-course-reading-host]")).toBeVisible();
}
