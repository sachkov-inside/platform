import { expect } from "@playwright/test";
import { afterAll, test } from "vitest";
import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";

const fixture = createOwnedBrowserFixture("live-search");
afterAll(() => fixture.close(), 30_000);

test("a new search replaces the deadline and a hidden search resumes with a fresh one", async () => {
  const { browsers, url } = await fixture.start();
  const chromium = browsers.get("chromium");
  if (!chromium) throw new Error("Missing Chromium");
  const page = await chromium.newPage();
  try {
    const start = new Date("2026-01-01T00:00:00Z");
    await page.clock.install({ time: start });
    await page.clock.pauseAt(new Date(start.getTime() + 1_000));
    await page.goto(url);
    const result = page.getByLabel("Search query");
    const draft = page.getByLabel("Draft");
    await expect(result).toHaveText("initial");
    await draft.fill("first");
    await page.clock.runFor(249);
    await expect(result).toHaveText("initial");
    await draft.fill("second");
    await page.clock.runFor(249);
    await expect(result).toHaveText("initial");
    await page.clock.runFor(1);
    await expect(result).toHaveText("second");

    await draft.fill("hidden update");
    await page.getByRole("button", { name: "Hide" }).click();
    await expect(result).toBeHidden();
    await page.clock.runFor(250);
    await page.getByRole("button", { name: "Show" }).click();
    await expect(result).toHaveText("second");
    await page.clock.runFor(250);
    await expect(result).toHaveText("hidden update");

    await draft.fill("final update");
    await page.getByRole("button", { name: "Unmount" }).click();
    await page.clock.runFor(250);
    await expect(result).toHaveCount(0);
  } finally {
    await page.close();
  }
}, 30_000);
