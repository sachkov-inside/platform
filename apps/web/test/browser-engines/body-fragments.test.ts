import { fileURLToPath } from "node:url";
import { chromium, webkit, expect as ui, type Browser } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { beforeAll, afterAll, test } from "vitest";

let server: ViteDevServer | undefined;
let settingUp: Promise<void> | undefined;
let shuttingDown = false;
const isShuttingDown = () => shuttingDown;
let url = "";
const browsers = new Map<string, Browser>();
async function setup() {
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../../", import.meta.url)),
    cacheDir: "node_modules/.cache/body-fragments-browser",
    define: { "process.env": "{}" },
    resolve: {
      alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
    },
    oxc: { jsx: { runtime: "automatic" } },
    server: { host: "127.0.0.1", port: 0 },
  });
  if (isShuttingDown()) return;
  await server.listen();
  if (isShuttingDown()) return;
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string")
    throw new Error("Missing body fragment listener");
  url = `http://127.0.0.1:${String(address.port)}/test/support/body-fragments.html`;
  browsers.set("chromium", await chromium.launch());
  if (isShuttingDown()) return;
  browsers.set("webkit", await webkit.launch());
}
beforeAll(() => {
  settingUp = setup();
  return settingUp;
}, 30_000);
afterAll(async () => {
  // A setup deadline does not cancel an acquisition that settles later (#2309).
  shuttingDown = true;
  await settingUp?.catch(() => undefined);
  const released = await Promise.allSettled([
    ...[...browsers.values()].map((browser) => browser.close()),
    ...(server === undefined ? [] : [server.close()]),
  ]);
  const failures: unknown[] = [];
  for (const result of released) {
    if (result.status === "rejected") failures.push(result.reason as unknown);
  }
  if (failures.length > 0)
    throw new AggregateError(failures, "Could not close body fragment fixture");
}, 30_000);

for (const engine of ["chromium", "webkit"]) {
  test(`${engine}: the repeated section link preserves a smooth scroll`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing body fragment browser");
    const page = await browser.newPage({
      reducedMotion: "no-preference",
      viewport: { width: 390, height: 844 },
    });
    try {
      await page.goto(url);
      const target = page.getByRole("heading", {
        name: "Target section",
        exact: true,
      });
      const link = page.getByRole("link", { name: "Read target", exact: true });
      const settled = () =>
        target.evaluate(
          (node) =>
            node.getBoundingClientRect().top <=
            Number.parseFloat(getComputedStyle(node).scrollMarginTop) + 1,
        );
      await link.click();
      await ui(target).toBeInViewport({ ratio: 1 });
      await ui.poll(settled).toBe(true);
      await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      await ui(link).toBeInViewport();
      await page.evaluate(() => {
        const positions = new Set<number>();
        document.addEventListener(
          "scroll",
          () => {
            positions.add(window.scrollY);
          },
          true,
        );
        Object.defineProperty(window, "fragmentScrollPositions", {
          get: () => positions.size,
        });
      });
      await link.click();
      await ui(target).toBeInViewport({ ratio: 1 });
      await ui.poll(settled).toBe(true);
      await ui
        .poll(() =>
          page.evaluate(() =>
            Number(Reflect.get(window, "fragmentScrollPositions")),
          ),
        )
        .toBeGreaterThan(2);
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: native same-page and repeated material links reach their section`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing body fragment browser");
    const page = await browser.newPage({
      reducedMotion: "reduce",
      viewport: { width: 390, height: 844 },
    });
    try {
      await page.goto(url);
      const target = page.getByRole("heading", {
        name: "Target section",
        exact: true,
      });
      const link = page.getByRole("link", { name: "Read target", exact: true });
      await ui(link).toBeVisible();
      await link.click();
      await ui(target).toBeInViewport();
      await ui(page).toHaveURL(/#target-section$/u);
      await ui(page.locator("body")).toBeFocused();
      const firstHistoryLength = await page.evaluate(() => history.length);
      await link.click();
      await ui(target).toBeInViewport();
      await ui(page.locator("body")).toBeFocused();
      await ui
        .poll(() => page.evaluate(() => history.length))
        .toBe(firstHistoryLength);
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: repeated fragment chooses the visible material without waiting for an animation frame`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing body fragment browser");
    const page = await browser.newPage({
      reducedMotion: "reduce",
      viewport: { width: 390, height: 844 },
    });
    try {
      await page.goto(url);
      const target = page.getByRole("heading", {
        name: "Target section",
        exact: true,
      });
      const link = page.getByRole("link", { name: "Read target", exact: true });
      await link.click();
      await ui(target).toBeInViewport();
      await page.clock.install({ time: new Date("2030-01-01T00:00:00.000Z") });
      await page.clock.pauseAt(new Date("2030-01-01T00:00:01.000Z"));
      await page.evaluate(() => {
        const retained = document.createElement("section");
        retained.hidden = true;
        const heading = document.createElement("h2");
        heading.id = "target-section";
        heading.textContent = "Hidden retained section";
        retained.append(heading);
        document.body.prepend(retained);
        window.scrollTo({ top: 0, behavior: "instant" });
      });
      await ui(link).toBeInViewport();
      await link.click();
      await ui(target).toBeInViewport();
      await ui(page).toHaveURL(/#target-section$/u);
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: the retained material releases fragment listeners while hidden or removed`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing body fragment browser");
    const page = await browser.newPage({
      reducedMotion: "reduce",
      viewport: { width: 390, height: 844 },
    });
    try {
      await page.addInitScript(() => {
        const handlers = new Set<EventListenerOrEventListenerObject>();
        const add = window.addEventListener.bind(window);
        const remove = window.removeEventListener.bind(window);
        window.addEventListener = (
          ...args: Parameters<typeof window.addEventListener>
        ) => {
          if (args[0] === "hashchange") handlers.add(args[1]);
          add(...args);
        };
        window.removeEventListener = (
          ...args: Parameters<typeof window.removeEventListener>
        ) => {
          if (args[0] === "hashchange") handlers.delete(args[1]);
          remove(...args);
        };
        Object.defineProperty(window, "materialFragmentListeners", {
          get: () => handlers.size,
        });
      });
      await page.goto(url);
      const count = () =>
        page.evaluate(() =>
          Number(Reflect.get(window, "materialFragmentListeners")),
        );
      const target = page.getByRole("heading", {
        name: "Target section",
        exact: true,
      });
      await ui.poll(count).toBe(1);
      await page
        .getByRole("link", { name: "Read target", exact: true })
        .click();
      await ui(target).toBeInViewport();
      await page
        .getByRole("button", { name: "Hide body", exact: true })
        .click();
      await ui(page.locator("[data-reader-body]")).toBeHidden();
      await ui.poll(count).toBe(0);
      await page
        .getByRole("button", { name: "Show body", exact: true })
        .click();
      await ui.poll(count).toBe(1);
      await ui(target).toBeInViewport();
      await page
        .getByRole("button", { name: "Remove body", exact: true })
        .click();
      await ui.poll(count).toBe(0);
      await ui(page.locator("[data-reader-body]")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Remount body", exact: true })
        .click();
      await ui.poll(count).toBe(1);
      await ui(target).toBeInViewport();
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: fragment scrolling restores the scroll root's previous inline policy`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing body fragment browser");
    const page = await browser.newPage({
      reducedMotion: "no-preference",
      viewport: { width: 390, height: 844 },
    });
    try {
      await page.goto(url);
      const target = page.getByRole("heading", {
        name: "Target section",
        exact: true,
      });
      await page.evaluate(() => {
        document.documentElement.style.setProperty(
          "scroll-behavior",
          "auto",
          "important",
        );
      });
      await page
        .getByRole("link", { name: "Read target", exact: true })
        .click();
      await ui(target).toBeInViewport();
      await ui
        .poll(() =>
          page.evaluate(() => ({
            value:
              document.documentElement.style.getPropertyValue(
                "scroll-behavior",
              ),
            priority:
              document.documentElement.style.getPropertyPriority(
                "scroll-behavior",
              ),
          })),
        )
        .toEqual({ value: "auto", priority: "important" });
    } finally {
      await page.close();
    }
  }, 30_000);
}
