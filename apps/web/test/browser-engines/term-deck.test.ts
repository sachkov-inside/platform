import { fileURLToPath } from "node:url";
import {
  chromium,
  webkit,
  expect as ui,
  type Browser,
  type Page,
} from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, test } from "vitest";

const browserLaunchBudgetMs = 30_000;
let server: ViteDevServer | undefined;
let settingUp: Promise<void> | undefined;
let shuttingDown = false;
const isShuttingDown = () => shuttingDown;
const browsers = new Map<string, Browser>();
let url = "";
async function setup() {
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../../", import.meta.url)),
    cacheDir: "node_modules/.cache/term-deck-browser",
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
    throw new Error("Missing term deck listener");
  url = `http://127.0.0.1:${String(address.port)}/test/support/term-deck.html`;
  browsers.set(
    "chromium",
    await chromium.launch({ timeout: browserLaunchBudgetMs }),
  );
  if (isShuttingDown()) return;
  browsers.set(
    "webkit",
    await webkit.launch({ timeout: browserLaunchBudgetMs }),
  );
}
beforeAll(() => {
  settingUp = setup();
  return settingUp;
}, 30_000);
afterAll(async () => {
  // A setup deadline does not cancel an acquisition that settles later (BF-STD-01).
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
    throw new AggregateError(failures, "Could not close term deck fixture");
}, 30_000);

async function ready(page: Page) {
  await page.goto(url);
  await ui(page.locator("[data-lesson-term-track]")).toHaveAttribute(
    "data-more-after",
    "",
  );
}
async function startNativeDrag(page: Page, distance: number) {
  const box = await page
    .locator('[data-lesson-term-card="alpha"]')
    .boundingBox();
  if (box === null) throw new Error("Missing first card geometry");
  const x = box.x + box.width / 2;
  const y = box.y + 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - distance, y, { steps: 5 });
  await ui(page.locator("[data-lesson-term-track]")).toHaveAttribute(
    "data-dragging",
    "",
  );
}
async function nativeDrag(page: Page, distance: number) {
  await startNativeDrag(page, distance);
  await page.mouse.up();
  await ui(page.locator("[data-lesson-term-track]")).not.toHaveAttribute(
    "data-dragging",
  );
}

for (const engine of ["chromium", "webkit"]) {
  test(`${engine}: baseline native drag, click and keyboard keep their own actions`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing term deck browser");
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    try {
      await ready(page);
      const first = page.locator('[data-lesson-term-card="alpha"]');
      await nativeDrag(page, 20);
      await ui(first).toHaveAccessibleName("Альфа");
      await first.click();
      await ui(first).toHaveAccessibleName("Определение альфы.");
      await first.press("Enter");
      await ui(first).toHaveAccessibleName("Альфа");
      await first.press("Space");
      await ui(first).toHaveAccessibleName("Определение альфы.");
      await first.press("ArrowRight");
      const second = page.locator('[data-lesson-term-card="beta"]');
      await ui(second).toBeFocused();
      await ui(second).toHaveAttribute("tabindex", "0");
      await ui(first).toHaveAttribute("tabindex", "-1");
      await ui(page.locator("[data-lesson-term-announcement]")).toHaveText(
        "Бета, 2 из 3",
      );
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: a delayed mouse click from the completed drag never flips the card`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing term deck browser");
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    try {
      await ready(page);
      await page.clock.install();
      const first = page.locator('[data-lesson-term-card="alpha"]');
      for (const [type, clientX] of [
        ["pointerdown", 300],
        ["pointermove", 280],
        ["pointerup", 280],
      ] as const) {
        await first.dispatchEvent(type, {
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX,
          clientY: 100,
        });
      }
      await page.clock.runFor(1);
      await first.dispatchEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 1,
      });
      await ui(first).toHaveAccessibleName("Альфа");
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: baseline retained visibility and term changes release their browser resources`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing term deck browser");
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    try {
      await page.addInitScript(() => {
        const active = new Set<ResizeObserver | MutationObserver>();
        const Original = window.ResizeObserver;
        window.ResizeObserver = class extends Original {
          override observe(target: Element, options?: ResizeObserverOptions) {
            super.observe(target, options);
            if (target.hasAttribute("data-lesson-term-track")) active.add(this);
          }
          override disconnect() {
            active.delete(this);
            super.disconnect();
          }
        };
        const OriginalMutation = window.MutationObserver;
        window.MutationObserver = class extends OriginalMutation {
          override observe(target: Node, options?: MutationObserverInit) {
            super.observe(target, options);
            if (
              target instanceof Element &&
              target.hasAttribute("data-lesson-term-track")
            )
              active.add(this);
          }
          override disconnect() {
            active.delete(this);
            super.disconnect();
          }
        };
        Object.defineProperty(window, "activeTermObservers", {
          get: () => active.size,
        });
      });
      await ready(page);
      const observers = () =>
        page.evaluate(() => Number(Reflect.get(window, "activeTermObservers")));
      const first = page.locator('[data-lesson-term-card="alpha"]');
      await ui.poll(observers).toBeGreaterThan(0);
      await first.click();
      await ui(first).toHaveAccessibleName("Определение альфы.");
      await page.getByRole("button", { name: "Hide", exact: true }).click();
      await ui(page.locator("[data-lesson-term-track]")).toBeHidden();
      await ui.poll(observers).toBe(0);
      await page.getByRole("button", { name: "Show", exact: true }).click();
      await ui.poll(observers).toBeGreaterThan(0);
      await ui(first).toHaveAccessibleName("Определение альфы.");
      await page.getByRole("button", { name: "One term", exact: true }).click();
      await ui(
        page.getByRole("button", { name: "Следующий термин" }),
      ).toHaveCount(0);
      await ui(page.getByRole("group")).toHaveCount(1);
      await ui(first).toHaveAccessibleName("Определение альфы.");
      await page
        .getByRole("button", { name: "All terms", exact: true })
        .click();
      await ui(
        page.getByRole("button", { name: "Следующий термин" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Remove", exact: true }).click();
      await ui.poll(observers).toBe(0);
      await ui(page.locator("[data-lesson-term-track]")).toHaveCount(0);
      await page.getByRole("button", { name: "Remount", exact: true }).click();
      await ui.poll(observers).toBeGreaterThan(0);
      await ui(first).toHaveAccessibleName("Альфа");
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: a retained selected card keeps its face and clamps when terms shrink`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing term deck browser");
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    try {
      await ready(page);
      const first = page.locator('[data-lesson-term-card="alpha"]');
      const second = page.locator('[data-lesson-term-card="beta"]');
      await first.press("ArrowRight");
      await ui(second).toBeFocused();
      await second.press("Enter");
      await ui(second).toHaveAccessibleName("Определение беты.");
      await page.getByRole("button", { name: "Hide", exact: true }).click();
      await ui(page.locator("[data-lesson-term-track]")).toBeHidden();
      await page.getByRole("button", { name: "Show", exact: true }).click();
      await ui(second).toHaveAttribute("tabindex", "0");
      await ui(second).toHaveAccessibleName("Определение беты.");
      await second.press("End");
      const last = page.locator('[data-lesson-term-card="gamma"]');
      await ui(last).toBeFocused();
      await ui(
        page.getByRole("button", { name: "Следующий термин" }),
      ).toBeDisabled();
      await last.press("Home");
      await ui(first).toBeFocused();
      await first.press("End");
      await ui(last).toHaveAttribute("tabindex", "0");
      await page.getByRole("button", { name: "One term", exact: true }).click();
      await ui(first).toHaveAttribute("tabindex", "0");
      await ui(page.locator("[data-lesson-term-announcement]")).toHaveText(
        "Альфа, 1 из 1",
      );
    } finally {
      await page.close();
    }
  }, 30_000);

  for (const ending of ["lost capture", "retained hide"]) {
    test(`${engine}: ${ending} ends an active drag without leaving the track dragging`, async () => {
      const browser = browsers.get(engine);
      if (browser === undefined) throw new Error("Missing term deck browser");
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        reducedMotion: "reduce",
      });
      try {
        await page.addInitScript(() => {
          let pointerId: number | undefined;
          window.addEventListener(
            "pointerdown",
            (event) => {
              if (
                event.target instanceof Element &&
                event.target.closest("[data-lesson-term-track]") !== null
              )
                pointerId = event.pointerId;
            },
            true,
          );
          Object.defineProperty(window, "termPointerId", {
            get: () => pointerId,
          });
        });
        await ready(page);
        await startNativeDrag(page, 20);
        const rail = page.locator("[data-lesson-term-track]");
        if (ending === "lost capture") {
          await rail.evaluate((element) => {
            const pointerId: unknown = Reflect.get(window, "termPointerId");
            if (
              typeof pointerId !== "number" ||
              !element.hasPointerCapture(pointerId)
            )
              throw new Error("The native drag did not capture its pointer");
            element.releasePointerCapture(pointerId);
          });
          await page.mouse.move(380, 5);
        } else {
          await page
            .getByRole("button", { name: "Hide", exact: true })
            .press("Enter");
          await ui(rail).toBeHidden();
        }
        await ui(rail).not.toHaveAttribute("data-dragging");
        await page.mouse.up();
        if (ending === "retained hide") {
          await page
            .getByRole("button", { name: "Show", exact: true })
            .press("Enter");
          await ui(rail).toBeVisible();
        }
        await ui(
          page.locator('[data-lesson-term-card="alpha"]'),
        ).toHaveAccessibleName("Альфа");
      } finally {
        await page.mouse.up();
        await page.close();
      }
    }, 30_000);
  }

  for (const input of ["keyboard", "touch"]) {
    test(`${engine}: cancel does not consume the next independent ${input} action`, async () => {
      const browser = browsers.get(engine);
      if (browser === undefined) throw new Error("Missing term deck browser");
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        reducedMotion: "reduce",
        hasTouch: input === "touch",
      });
      try {
        await ready(page);
        const first = page.locator('[data-lesson-term-card="alpha"]');
        for (const [type, clientX] of [
          ["pointerdown", 300],
          ["pointermove", 280],
          ["pointercancel", 280],
        ] as const) {
          await first.dispatchEvent(type, {
            pointerId: 1,
            pointerType: "mouse",
            button: 0,
            buttons: type === "pointercancel" ? 0 : 1,
            clientX,
            clientY: 100,
          });
        }
        if (input === "keyboard") {
          await first.press("Enter");
          await ui(first).toHaveAccessibleName("Определение альфы.");
          await first.press("Space");
          await ui(first).toHaveAccessibleName("Альфа");
        } else {
          const box = await first.boundingBox();
          if (box === null) throw new Error("Missing touch card geometry");
          await page.touchscreen.tap(box.x + box.width / 2, box.y + 40);
          await ui(first).toHaveAccessibleName("Определение альфы.");
        }
      } finally {
        await page.close();
      }
    }, 30_000);
  }
}
