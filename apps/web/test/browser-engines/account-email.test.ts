import { expect } from "@playwright/test";
import { afterAll, test } from "vitest";
import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";

declare global {
  interface Window {
    emailReads(): boolean[][];
  }
}

const fixture = createOwnedBrowserFixture("account-email");
afterAll(() => fixture.close(), 30_000);

test("an email announcement joins the pending read and refreshes only the mounted cache", async () => {
  const { browsers, url } = await fixture.start();
  const chromium = browsers.get("chromium");
  if (!chromium) throw new Error("Missing Chromium");
  const page = await chromium.newPage();
  const pending = Promise.withResolvers<undefined>();
  try {
    let reads = 0;
    await page.route("**/api/account/email", async (route) => {
      const read = ++reads;
      if (read === 2) await pending.promise;
      await route.fulfill({
        json: {
          ok: true,
          email:
            read === 2
              ? "attached@example.org"
              : `reader${String(read)}@example.org`,
        },
      });
    });
    await page.goto(url);
    const next = page.getByRole("button", { name: "Следующий читатель" });
    const announce = page.getByRole("button", {
      name: "Сообщить о новом адресе",
    });
    await expect(page.getByText("reader1@example.org")).toBeVisible();
    await announce.click();
    await expect.poll(() => reads).toBe(2);
    await announce.click();
    pending.resolve(undefined);
    await expect(page.getByText("attached@example.org")).toBeVisible();
    expect(reads).toBe(2);
    await next.click();
    await expect(page.getByText("reader3@example.org")).toBeVisible();
    await announce.click();
    await expect(page.getByText("reader4@example.org")).toBeVisible();
    await next.click();
    const restore = page.getByRole("button", { name: "Вернуть панель" });
    await expect(restore).toBeVisible();
    await announce.click();
    expect(await page.evaluate(() => window.emailReads())).toEqual([
      [false],
      [false],
    ]);
    expect(reads).toBe(4);
    await restore.click();
    await expect(page.getByText("reader5@example.org")).toBeVisible();
  } finally {
    pending.resolve(undefined);
    await page.close();
  }
}, 30_000);
