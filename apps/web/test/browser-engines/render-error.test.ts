import { expect } from "@playwright/test";
import { afterAll, test } from "vitest";
import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";

const fixture = createOwnedBrowserFixture("render-error");
afterAll(() => fixture.close(), 30_000);

test("the committed boundary reports changes without repeating the same error", async () => {
  const { browsers, url } = await fixture.start();
  const chromium = browsers.get("chromium");
  if (!chromium) throw new Error("Missing Chromium");
  const page = await chromium.newPage();
  try {
    const reports: unknown[] = [];
    await page.route("**/api/render-errors", async (route) => {
      reports.push(route.request().postDataJSON());
      await route.fulfill({ status: 204 });
    });
    await page.goto(url);
    await expect.poll(() => reports.length).toBe(1);
    await page.getByRole("button", { name: "Render again" }).click();
    await expect(page.getByLabel("Render count")).toHaveText("1");
    await page.getByRole("button", { name: "Replace error" }).click();
    await expect.poll(() => reports.length).toBe(2);
    await page.getByRole("button", { name: "Use public boundary" }).click();
    await expect
      .poll(() => reports)
      .toEqual([
        expect.objectContaining({
          boundary: "root",
          message: "First",
          name: "Error",
        }),
        expect.objectContaining({
          boundary: "root",
          message: "Next",
          name: "Error",
        }),
        expect.objectContaining({
          boundary: "public",
          message: "Next",
          name: "Error",
        }),
      ]);
  } finally {
    await page.close();
  }
}, 30_000);
