import { expect } from "@playwright/test";
import { afterAll, test } from "vitest";
import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";

declare global {
  interface Window {
    readingCacheFixture: {
      seed(): void;
      completePending(): void;
      mutationNames(): string[];
      showAction(resolved: boolean, canMark: boolean): void;
      showProvider(
        account: string | null,
        resolved: boolean,
        replace?: boolean,
      ): void;
      signOut(path: string): unknown;
      unmount(): void;
      resolveObsoleteRead(): Promise<unknown>;
    };
  }
}

const fixture = createOwnedBrowserFixture("reading-cache");
afterAll(() => fixture.close(), 30_000);

async function reader() {
  const { browsers, url } = await fixture.start();
  const chromium = browsers.get("chromium");
  if (!chromium) throw new Error("Missing Chromium");
  const page = await chromium.newPage();
  try {
    await page.goto(url);
    await page.waitForFunction(() =>
      Reflect.has(window, "readingCacheFixture"),
    );
    return page;
  } catch (error) {
    await page.close();
    throw error;
  }
}

test("only a resolved Account change cancels the obsolete private read", async () => {
  const page = await reader();
  try {
    expect(
      await page.evaluate(() =>
        window.readingCacheFixture.resolveObsoleteRead(),
      ),
    ).toEqual({
      unresolved: "fetching",
      receipt: "cancelled",
      data: undefined,
    });
  } finally {
    await page.close();
  }
}, 30_000);

test("sign-out clears the replacement cache before the form target and releases on removal", async () => {
  const page = await reader();
  try {
    const result = await page.evaluate(() => {
      const reader = window.readingCacheFixture;
      reader.showProvider("a", true);
      reader.showProvider("b", true, true);
      const unrelated = reader.signOut("/another-action");
      const signOut = reader.signOut("/auth/sign-out");
      reader.unmount();
      const afterUnmount = reader.signOut("/auth/sign-out");
      return { unrelated, signOut, afterUnmount };
    });
    expect(result).toEqual({
      unrelated: { privateAtSubmit: "private", publicAfter: "public" },
      signOut: { privateAtSubmit: undefined, publicAfter: "public" },
      afterUnmount: { privateAtSubmit: "private", publicAfter: "public" },
    });
  } finally {
    await page.close();
  }
}, 30_000);

test("restored marking rights release only an earlier completed denial", async () => {
  const page = await reader();
  try {
    const names = () =>
      page.evaluate(() => window.readingCacheFixture.mutationNames());
    await page.evaluate(() => {
      window.readingCacheFixture.seed();
      window.readingCacheFixture.showAction(false, true);
    });
    expect(await names()).toContain("previous");
    await page.evaluate(() => {
      window.readingCacheFixture.showAction(true, false);
    });
    expect(await names()).toContain("previous");
    await page.evaluate(() => {
      window.readingCacheFixture.showAction(true, true);
    });
    const retained = [
      "failed",
      "pending",
      "other",
      "otherAccount",
      "unavailable",
    ];
    await expect.poll(names).toEqual(retained);
    const button = page.getByRole("button");
    await expect(button).toHaveAttribute("aria-busy", "true");
    await page.evaluate(() => {
      window.readingCacheFixture.completePending();
    });
    await expect(button).toHaveAccessibleDescription(
      "Чтобы отметить материал, нужен доступ к нему.",
    );
    await expect(button).toHaveAttribute("aria-disabled", "true");
    expect(await names()).toContain("newDenial");
  } finally {
    await page.close();
  }
}, 30_000);
