import { expect } from "@playwright/test";
import { afterAll, test } from "vitest";
import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";

declare global {
  interface Window {
    liveSearchFixture: {
      show(query: string, mode: "visible" | "hidden"): void;
      pending(): number;
      unmount(): void;
    };
  }
}

const fixture = createOwnedBrowserFixture("live-search");
afterAll(() => fixture.close(), 30_000);

test("replacement, hiding and unmount release the active search timer", async () => {
  const { browsers, url } = await fixture.start();
  const chromium = browsers.get("chromium");
  if (!chromium) throw new Error("Missing Chromium");
  const page = await chromium.newPage();
  try {
    const start = new Date("2026-01-01T00:00:00Z");
    await page.clock.install({ time: start });
    await page.clock.pauseAt(new Date(start.getTime() + 1_000));
    await page.goto(url);
    await page.waitForFunction(() => Reflect.has(window, "liveSearchFixture"));
    const result = page.getByLabel("Search query");
    const show = (query: string, mode: "visible" | "hidden" = "visible") =>
      page.evaluate(
        ([text, visibility]) => {
          window.liveSearchFixture.show(text, visibility);
        },
        [query, mode] as const,
      );
    const pending = () =>
      page.evaluate(() => window.liveSearchFixture.pending());
    await show("initial");
    await expect(result).toHaveText("initial");
    await show("first");
    await expect.poll(pending).toBe(1);
    await page.clock.runFor(249);
    await expect(result).toHaveText("initial");
    await show("second");
    await expect.poll(pending).toBe(1);
    await page.clock.runFor(249);
    await expect(result).toHaveText("initial");
    await page.clock.runFor(1);
    await expect(result).toHaveText("second");

    await show("hidden update");
    await expect.poll(pending).toBe(1);
    await show("hidden update", "hidden");
    await expect.poll(pending).toBe(0);
    await page.clock.runFor(250);
    await show("hidden update");
    await expect.poll(pending).toBe(1);
    await expect(result).toHaveText("second");
    await page.clock.runFor(250);
    await expect(result).toHaveText("hidden update");

    await show("final update");
    await expect.poll(pending).toBe(1);
    await page.evaluate(() => {
      window.liveSearchFixture.unmount();
    });
    await expect.poll(pending).toBe(0);
  } finally {
    await page.close();
  }
}, 30_000);
