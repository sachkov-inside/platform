import { expect as browserExpect, type Browser } from "@playwright/test";
import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";
import { afterAll, beforeAll, test } from "vitest";

const fixture = createOwnedBrowserFixture("reader-history");
let browsers: ReadonlyMap<string, Browser> = new Map();
let baseURL = "";
beforeAll(async () => {
  const started = await fixture.start();
  browsers = started.browsers;
  baseURL = new URL(started.url).origin;
}, 30_000);
afterAll(() => fixture.close(), 30_000);

function browserFor(name: string): Browser {
  const browser = browsers.get(name);
  if (browser === undefined) throw new Error(`Missing fixture browser ${name}`);
  return browser;
}

for (const name of ["chromium", "webkit"] as const)
  test(`${name} restores the originating entry through nested documents, reload and explicit return without leaking to another tab`, async () => {
    const context = await browserFor(name).newContext();
    try {
      const page = await context.newPage();
      const source = `${baseURL}/products/course/tasks/start?attemptsAfter=older#submission`;
      await page.goto(source);
      await browserExpect(page.getByRole("heading")).toHaveText(
        "/products/course/tasks/start",
      );
      await page.waitForFunction(() => "readerHistoryReady" in window);
      await page.locator("main").evaluate((element) => {
        element.scrollTop = 600;
      });
      await page
        .locator("[data-reader-history-root] [data-course-rail-scroll]")
        .evaluate((element) => {
          element.scrollTop = 100;
        });
      // Scroll the link into view with keyboard focus without changing the saved reading position.
      await page.locator("#project").dispatchEvent("click", { button: 0 });
      await browserExpect(page.getByRole("heading")).toHaveText(
        "/materials/project",
      );
      await page.locator("#brief").click();
      await browserExpect(page.getByRole("heading")).toHaveText(
        "/materials/brief",
      );
      await page.reload();
      await page.waitForFunction(() => "readerHistoryReady" in window);
      await browserExpect(page.locator("#return")).toHaveAttribute(
        "href",
        source,
      );
      const other = await context.newPage();
      await other.goto(page.url());
      await other.waitForFunction(() => "readerHistoryReady" in window);
      await browserExpect(other.locator("#return")).toHaveAttribute(
        "href",
        "/products/course/tasks/start",
      );
      await other.close();
      await page.goBack();
      await browserExpect(page.getByRole("heading")).toHaveText(
        "/materials/project",
      );
      await page.locator("#return").click();
      await browserExpect(page).toHaveURL(source);
      await browserExpect
        .poll(() =>
          page.locator("main").evaluate((element) => element.scrollTop),
        )
        .toBe(600);
      await browserExpect(page.locator("html")).toHaveAttribute(
        "data-restored-chapter",
        "second",
      );
      await browserExpect
        .poll(() =>
          page
            .locator("[data-reader-history-root] [data-course-rail-scroll]")
            .evaluate((element) => element.scrollTop),
        )
        .toBe(100);
    } finally {
      await context.close();
    }
  }, 30_000);

for (const name of ["chromium", "webkit"] as const)
  test(`${name} retains the origin when an intermediate reference has not activated its Tracker`, async () => {
    const context = await browserFor(name).newContext();
    try {
      const page = await context.newPage();
      const source = `${baseURL}/products/course/tasks/start`;
      await page.goto(source);
      await page.waitForFunction(() => "readerHistoryReady" in window);
      await page.locator("main").evaluate((element) => {
        element.scrollTop = 600;
      });
      await page.locator("#project").evaluate((element) => {
        if (element instanceof HTMLAnchorElement)
          element.href += "&deferHistory=1";
      });
      await page.locator("#project").dispatchEvent("click", { button: 0 });
      await browserExpect(page.getByRole("heading")).toHaveText(
        "/materials/project",
      );
      browserExpect(
        await page.evaluate(
          () =>
            Reflect.get(window.history.state ?? {}, "insideReader") !==
            undefined,
        ),
      ).toBe(false);
      await page.locator("#brief").click();
      await browserExpect(page.getByRole("heading")).toHaveText(
        "/materials/brief",
      );
      await page.locator("#return").click();
      await browserExpect(page).toHaveURL(source);
      await browserExpect
        .poll(() =>
          page.locator("main").evaluate((element) => element.scrollTop),
        )
        .toBe(600);
    } finally {
      await context.close();
    }
  }, 30_000);

for (const name of ["chromium", "webkit"] as const)
  test(`${name} restores a ready reading view while animation frames are suspended`, async () => {
    const context = await browserFor(name).newContext();
    try {
      const page = await context.newPage();
      // Time is the substitute: an already committed document needs no frame-count barrier.
      await page.addInitScript(() => {
        window.requestAnimationFrame = () => 0;
        window.cancelAnimationFrame = () => undefined;
      });
      const source = `${baseURL}/products/course/tasks/start?attemptsAfter=older#submission`;
      await page.goto(source);
      await page.waitForFunction(() => "readerHistoryReady" in window);
      await page.locator("main").evaluate((element) => {
        element.scrollTop = 600;
      });
      await page
        .locator("[data-reader-history-root] [data-course-rail-scroll]")
        .evaluate((element) => {
          element.scrollTop = 100;
        });
      await page.locator("#project").dispatchEvent("click", { button: 0 });
      await browserExpect(page.getByRole("heading")).toHaveText(
        "/materials/project",
      );
      await page.locator("#return").click();
      await browserExpect(page).toHaveURL(source);
      await browserExpect
        .poll(() =>
          page.locator("main").evaluate((element) => element.scrollTop),
        )
        .toBe(600);
      await browserExpect
        .poll(() =>
          page
            .locator("[data-reader-history-root] [data-course-rail-scroll]")
            .evaluate((element) => element.scrollTop),
        )
        .toBe(100);
      await browserExpect(page.locator("html")).toHaveAttribute(
        "data-restored-chapter",
        "second",
      );
    } finally {
      await context.close();
    }
  }, 30_000);

for (const name of ["chromium", "webkit"] as const)
  test(`${name} waits for the requested chapter DOM before restoring its rail`, async () => {
    const context = await browserFor(name).newContext();
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.requestAnimationFrame = () => 0;
        window.cancelAnimationFrame = () => undefined;
      });
      const source = `${baseURL}/products/course/tasks/start`;
      await page.goto(source);
      await page.waitForFunction(() => "readerHistoryReady" in window);
      await page.locator("main").evaluate((element) => {
        element.scrollTop = 600;
      });
      await page
        .locator("[data-reader-history-root] [data-course-rail-scroll]")
        .evaluate((element) => {
          element.scrollTop = 100;
        });
      await page.locator("#project").dispatchEvent("click", { button: 0 });
      await browserExpect(page.getByRole("heading")).toHaveText(
        "/materials/project",
      );
      await page
        .getByRole("button", { name: "Wait for the next chapter" })
        .click();
      await page.locator("#return").click();
      await browserExpect(page).toHaveURL(source);
      const chapter = page.locator(
        "[data-reader-history-root] [data-course-chapter]",
      );
      await browserExpect(chapter).toHaveAttribute(
        "data-course-chapter",
        "first",
      );
      await browserExpect
        .poll(() =>
          page.locator("main").evaluate((element) => element.scrollTop),
        )
        .toBe(0);
      await page
        .getByRole("button", { name: "Commit the requested chapter" })
        .click();
      await browserExpect(chapter).toHaveAttribute(
        "data-course-chapter",
        "second",
      );
      await browserExpect
        .poll(() =>
          page.locator("main").evaluate((element) => element.scrollTop),
        )
        .toBe(600);
      await browserExpect
        .poll(() =>
          page
            .locator("[data-reader-history-root] [data-course-rail-scroll]")
            .evaluate((element) => element.scrollTop),
        )
        .toBe(100);
    } finally {
      await context.close();
    }
  }, 30_000);

for (const name of ["chromium", "webkit"] as const)
  test(`${name} delivers a pending chapter restoration to a newly connected rail`, async () => {
    const context = await browserFor(name).newContext();
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.requestAnimationFrame = () => 0;
        window.cancelAnimationFrame = () => undefined;
      });
      const source = `${baseURL}/products/course/tasks/start`;
      await page.goto(source);
      await page.waitForFunction(() => "readerHistoryReady" in window);
      await page.locator("main").evaluate((element) => {
        element.scrollTop = 600;
      });
      await page
        .locator("[data-reader-history-root] [data-course-rail-scroll]")
        .evaluate((element) => {
          element.scrollTop = 100;
        });
      await page.locator("#project").dispatchEvent("click", { button: 0 });
      await browserExpect(page.getByRole("heading")).toHaveText(
        "/materials/project",
      );
      await page
        .getByRole("button", { name: "Wait for the chapter subscription" })
        .click();
      await page.locator("#return").click();
      await browserExpect(page).toHaveURL(source);
      const chapter = page.locator(
        "[data-reader-history-root] [data-course-chapter]",
      );
      await browserExpect(chapter).toHaveAttribute(
        "data-course-chapter",
        "first",
      );
      await browserExpect
        .poll(() =>
          page.locator("main").evaluate((element) => element.scrollTop),
        )
        .toBe(0);
      await page
        .getByRole("button", { name: "Connect the chapter subscription" })
        .click();
      await browserExpect(chapter).toHaveAttribute(
        "data-course-chapter",
        "second",
      );
      await browserExpect
        .poll(() =>
          page.locator("main").evaluate((element) => element.scrollTop),
        )
        .toBe(600);
      await browserExpect
        .poll(() =>
          page
            .locator("[data-reader-history-root] [data-course-rail-scroll]")
            .evaluate((element) => element.scrollTop),
        )
        .toBe(100);
    } finally {
      await context.close();
    }
  }, 30_000);

for (const name of ["chromium", "webkit"] as const)
  test(`${name} cancels the reader's pending observation before later chapter changes`, async () => {
    const context = await browserFor(name).newContext();
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const active = new Set<MutationObserver>();
        const NativeObserver = window.MutationObserver;
        window.MutationObserver = class extends NativeObserver {
          override observe(target: Node, options?: MutationObserverInit) {
            if (
              target instanceof Element &&
              target.matches("[data-reader-history-root]")
            )
              active.add(this);
            super.observe(target, options);
          }
          override disconnect() {
            active.delete(this);
            super.disconnect();
          }
        };
        Object.defineProperty(window, "activeReaderObservers", {
          get: () => active.size,
        });
        window.requestAnimationFrame = () => 0;
        window.cancelAnimationFrame = () => undefined;
      });
      const source = `${baseURL}/products/course/tasks/start`;
      await page.goto(source);
      await page.waitForFunction(() => "readerHistoryReady" in window);
      await page.locator("main").evaluate((element) => {
        element.scrollTop = 600;
      });
      await page.locator("#project").dispatchEvent("click", { button: 0 });
      await page
        .getByRole("button", { name: "Wait for the next chapter" })
        .dispatchEvent("click");
      await page.locator("#return").click();
      await browserExpect(page).toHaveURL(source);
      await browserExpect
        .poll(() =>
          page.evaluate(() => {
            const count: unknown = Reflect.get(window, "activeReaderObservers");
            return typeof count === "number" ? count : undefined;
          }),
        )
        .toBe(1);
      await page
        .getByRole("button", { name: "Disconnect the reader" })
        .dispatchEvent("click");
      await browserExpect
        .poll(() =>
          page.evaluate(() => {
            const count: unknown = Reflect.get(window, "activeReaderObservers");
            return typeof count === "number" ? count : undefined;
          }),
        )
        .toBe(0);
      await page.locator("main").evaluate((element) => {
        element.scrollTop = 37;
      });
      await page
        .getByRole("button", { name: "Commit the requested chapter" })
        .dispatchEvent("click");
      await browserExpect(
        page.locator("[data-reader-history-root] [data-course-chapter]"),
      ).toHaveAttribute("data-course-chapter", "second");
      await browserExpect
        .poll(() =>
          page.locator("main").evaluate((element) => element.scrollTop),
        )
        .toBe(37);
      await browserExpect
        .poll(() =>
          page.evaluate(() => {
            const count: unknown = Reflect.get(window, "activeReaderObservers");
            return typeof count === "number" ? count : undefined;
          }),
        )
        .toBe(0);
    } finally {
      await context.close();
    }
  }, 30_000);

for (const name of ["chromium", "webkit"] as const)
  test(`${name} restores the reading position when the saved chapter no longer exists`, async () => {
    const context = await browserFor(name).newContext();
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.requestAnimationFrame = () => 0;
        window.cancelAnimationFrame = () => undefined;
      });
      const source = `${baseURL}/products/course/tasks/start`;
      await page.goto(source);
      await page.waitForFunction(() => "readerHistoryReady" in window);
      await page.locator("main").evaluate((element) => {
        element.scrollTop = 600;
      });
      await page
        .locator("[data-reader-history-root] [data-course-rail-scroll]")
        .evaluate((element) => {
          element.scrollTop = 100;
        });
      await page.locator("#project").dispatchEvent("click", { button: 0 });
      await page
        .getByRole("button", { name: "Wait for the next chapter" })
        .dispatchEvent("click");
      await page.locator("#return").click();
      await browserExpect(page).toHaveURL(source);
      await browserExpect(
        page.locator("[data-reader-history-root] [data-course-chapter]"),
      ).toHaveAttribute("data-course-chapter", "first");
      await page
        .getByRole("button", { name: "Use remaining chapters" })
        .dispatchEvent("click");
      await browserExpect
        .poll(() =>
          page.locator("main").evaluate((element) => element.scrollTop),
        )
        .toBe(600);
      await browserExpect(
        page.locator("[data-reader-history-root] [data-course-chapter]"),
      ).toHaveAttribute("data-course-chapter", "first");
      await browserExpect
        .poll(() =>
          page
            .locator("[data-reader-history-root] [data-course-rail-scroll]")
            .evaluate((element) => element.scrollTop),
        )
        .toBe(0);
    } finally {
      await context.close();
    }
  }, 30_000);

for (const name of ["chromium", "webkit"] as const)
  test(`${name} waits while the pending reader is hidden and restores when visible`, async () => {
    const context = await browserFor(name).newContext();
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.requestAnimationFrame = () => 0;
        window.cancelAnimationFrame = () => undefined;
      });
      const source = `${baseURL}/products/course/tasks/start`;
      await page.goto(source);
      await page.waitForFunction(() => "readerHistoryReady" in window);
      await page.locator("main").evaluate((element) => {
        element.scrollTop = 600;
      });
      await page
        .locator("[data-reader-history-root] [data-course-rail-scroll]")
        .evaluate((element) => {
          element.scrollTop = 100;
        });
      await page.locator("#project").dispatchEvent("click", { button: 0 });
      await page
        .getByRole("button", { name: "Wait for the next chapter" })
        .dispatchEvent("click");
      await page.locator("#return").click();
      await browserExpect(page).toHaveURL(source);
      const root = page.locator("[data-reader-history-root]");
      await root.evaluate((element) => {
        if (element instanceof HTMLElement) element.hidden = true;
      });
      await page.locator("#ready-chapter").dispatchEvent("click");
      await browserExpect(root).toBeHidden();
      await browserExpect
        .poll(() =>
          page.locator("main").evaluate((element) => element.scrollTop),
        )
        .toBe(0);
      await root.evaluate((element) => {
        if (element instanceof HTMLElement) element.hidden = false;
      });
      await browserExpect(root).toBeVisible();
      await browserExpect
        .poll(() =>
          page.locator("main").evaluate((element) => element.scrollTop),
        )
        .toBe(600);
      await browserExpect
        .poll(() =>
          page
            .locator("[data-reader-history-root] [data-course-rail-scroll]")
            .evaluate((element) => element.scrollTop),
        )
        .toBe(100);
    } finally {
      await context.close();
    }
  }, 30_000);

for (const name of ["chromium", "webkit"] as const)
  test(`${name} discards a pending position when another browser history entry wins`, async () => {
    const context = await browserFor(name).newContext();
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.requestAnimationFrame = () => 0;
        window.cancelAnimationFrame = () => undefined;
      });
      const source = `${baseURL}/products/course/tasks/start`;
      await page.goto(source);
      await page.waitForFunction(() => "readerHistoryReady" in window);
      await page.locator("main").evaluate((element) => {
        element.scrollTop = 600;
      });
      await page.locator("#project").dispatchEvent("click", { button: 0 });
      await page
        .getByRole("button", { name: "Wait for the next chapter" })
        .dispatchEvent("click");
      await page.locator("#return").click();
      await browserExpect(page).toHaveURL(source);
      // Browser history is the public input; the former DOM remains to model a retained document.
      await page.evaluate(() => {
        history.pushState({ __NA: true }, "", "/materials/another-entry");
      });
      await page.locator("main").evaluate((element) => {
        element.scrollTop = 37;
      });
      await page.locator("#ready-chapter").dispatchEvent("click");
      await browserExpect(page).toHaveURL(`${baseURL}/materials/another-entry`);
      await browserExpect(
        page.locator("[data-reader-history-root] [data-course-chapter]"),
      ).toHaveAttribute("data-course-chapter", "second");
      await browserExpect
        .poll(() =>
          page.locator("main").evaluate((element) => element.scrollTop),
        )
        .toBe(37);
    } finally {
      await context.close();
    }
  }, 30_000);

for (const name of ["chromium", "webkit"] as const)
  test(`${name} restores a visible reader when its optional chapter rail is hidden`, async () => {
    const context = await browserFor(name).newContext();
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.requestAnimationFrame = () => 0;
        window.cancelAnimationFrame = () => undefined;
      });
      const source = `${baseURL}/products/course/tasks/start`;
      await page.goto(source);
      await page.waitForFunction(() => "readerHistoryReady" in window);
      await page
        .getByRole("button", { name: "Hide the optional rail" })
        .dispatchEvent("click");
      await page.locator("main").evaluate((element) => {
        element.scrollTop = 600;
      });
      await page.locator("#project").dispatchEvent("click", { button: 0 });
      await page.locator("#return").click();
      await browserExpect(page).toHaveURL(source);
      await browserExpect(
        page.locator("[data-reader-history-root]"),
      ).toBeVisible();
      await browserExpect(
        page.locator("[data-reader-history-root] [data-course-chapter]"),
      ).toBeHidden();
      await browserExpect
        .poll(() =>
          page.locator("main").evaluate((element) => element.scrollTop),
        )
        .toBe(600);
    } finally {
      await context.close();
    }
  }, 30_000);
