import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, test } from "vitest";

let server: ViteDevServer;
let cacheDirectory: string;
let origin: string;
beforeAll(async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  // Other browser fixtures have their own optimizer config and must not replace our dependency cache.
  cacheDirectory = await mkdtemp(join(tmpdir(), "inside-reader-handoff-"));
  server = await createServer({
    configFile: false,
    cacheDir: cacheDirectory,
    root,
    oxc: { jsx: { runtime: "automatic" } },
    optimizeDeps: { include: ["react-dom/server"] },
    resolve: {
      alias: {
        "@": `${root}/src`,
        "next/navigation": `${root}/test/support/course-reading-router.ts`,
        "next/link": `${root}/.storybook/mocks/next-link.tsx`,
      },
    },
    // This immutable fixture must not reload when a concurrent production build writes HTML.
    server: { host: "127.0.0.1", port: 0, watch: null },
    plugins: [
      {
        name: "reader-handoff",
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (request.url?.startsWith("/materials/step-0?") !== true) {
              next();
              return;
            }
            response.setHeader("content-type", "text/html");
            response.end(
              '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><button id="release">Resolve route</button><script type="module" src="/test/support/course-reading-handoff.tsx"></script>',
            );
          });
        },
      },
    ],
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === undefined || address === null || typeof address === "string")
    throw new Error("No browser fixture address");
  origin = `http://127.0.0.1:${String(address.port)}`;
});
afterAll(async () => {
  try {
    await server.close();
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

test("desktop retains an early chapter choice and focus through host activation", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1024 },
    });
    await page.goto(
      `${origin}/materials/step-0?from=%2Fproducts%2Fai-engineering%2Fprogramme`,
    );
    const rail = page.getByRole("complementary", { name: "Текущая глава" });
    const chapter = rail.getByRole("button", {
      name: /Глава 1 из 2 First chapter/,
    });
    await chapter.click();
    await rail.getByRole("button", { name: /Глава 2 Second chapter/ }).click();
    const selected = rail.getByRole("button", {
      name: /Глава 2 из 2 Second chapter/,
    });
    await expect(selected).toBeFocused();
    await expect(page.locator("[data-course-reading-host]")).toHaveCount(0);
    const before = await page
      .getByRole("heading", { name: "Reader body" })
      .boundingBox();
    // Resolve the external observer without stealing the reader's focus.
    await page.locator("#release").dispatchEvent("click");
    await expect(page.locator("[data-course-reading-host]")).toBeVisible();
    await expect(selected).toBeVisible();
    await expect(selected).toBeFocused();
    expect(
      await page.getByRole("heading", { name: "Reader body" }).boundingBox(),
    ).toEqual(before);
  } finally {
    await browser.close();
  }
}, 30_000);

test("desktop retains early reference expansion and rail scroll through host activation", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1024 },
    });
    await page.goto(
      `${origin}/materials/step-0?from=%2Fproducts%2Fai-engineering%2Fprogramme`,
    );
    const rail = page.getByRole("complementary", { name: "Текущая глава" });
    await rail.getByRole("button", { name: "Показать ещё" }).click();
    const collapse = rail.getByRole("button", { name: "Скрыть" });
    await expect(collapse).toBeFocused();
    const scroll = rail.locator("[data-course-rail-scroll]");
    const position = await scroll.evaluate((node) => {
      node.scrollTop -= 40;
      return node.scrollTop;
    });
    expect(position).toBeGreaterThan(0);
    await expect(page.locator("[data-course-reading-host]")).toHaveCount(0);
    await page.locator("#release").dispatchEvent("click");
    await expect(page.locator("[data-course-reading-host]")).toBeVisible();
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await expect(collapse).toBeFocused();
    expect(await scroll.evaluate((node) => node.scrollTop)).toBe(position);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Вся программа", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Показать ещё" }),
    ).toHaveAttribute("aria-expanded", "false");
  } finally {
    await browser.close();
  }
}, 30_000);

for (const width of [390, 820])
  test(`width ${String(width)} retains the early open programme, chapter choice, reference expansion, focus and scroll`, async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({
        viewport: { width, height: 844 },
        isMobile: width === 390,
        hasTouch: true,
      });
      await page.goto(
        `${origin}/materials/step-0?from=%2Fproducts%2Fai-engineering%2Fprogramme`,
      );
      const trigger = page.getByRole("button", {
        name: "Вся программа",
        exact: true,
      });
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole("button", { name: /Глава 1 из 2 First chapter/ })
        .click();
      await dialog
        .getByRole("button", { name: /Глава 2 Second chapter/ })
        .click();
      const selected = dialog.getByRole("button", {
        name: /Глава 2 из 2 Second chapter/,
      });
      await expect(selected).toBeFocused();
      await dialog.getByRole("button", { name: "Показать ещё" }).click();
      const collapse = dialog.getByRole("button", { name: "Скрыть" });
      await expect(collapse).toBeFocused();
      const position = await dialog.evaluate((node) => {
        node.scrollTop -= 24;
        return node.scrollTop;
      });
      expect(position).toBeGreaterThan(0);
      await expect(page.locator("[data-course-reading-host]")).toHaveCount(0);
      const before = await page
        .getByRole("heading", { name: "Reader body" })
        .boundingBox();
      const dialogBefore = await dialog.boundingBox();
      await page.locator("#release").dispatchEvent("click");
      await expect(page.locator("[data-course-reading-host]")).toBeVisible();
      await expect(dialog).toBeVisible();
      expect(await dialog.boundingBox()).toEqual(dialogBefore);
      expect(
        await page.getByRole("heading", { name: "Reader body" }).boundingBox(),
      ).toEqual(before);
      await expect(selected).toBeVisible();
      await expect(collapse).toHaveAttribute("aria-expanded", "true");
      await expect(collapse).toBeFocused();
      expect(await dialog.evaluate((node) => node.scrollTop)).toBe(position);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      // The sheet and desktop rail are independent controls, even during their first transfer.
      await page.setViewportSize({ width: 1440, height: 1024 });
      const rail = page.getByRole("complementary", { name: "Текущая глава" });
      await expect(
        rail.getByRole("button", { name: /Глава 1 из 2 First chapter/ }),
      ).toBeVisible();
      await expect(
        rail.getByRole("button", { name: "Показать ещё" }),
      ).toHaveAttribute("aria-expanded", "false");
    } finally {
      await browser.close();
    }
  }, 30_000);

test("desktop preserves an early scroll back to the top instead of revealing the current step again", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1024 },
    });
    await page.goto(
      `${origin}/materials/step-0?from=%2Fproducts%2Fai-engineering%2Fprogramme&last=1`,
    );
    const scroll = page.locator("[data-course-rail-scroll]");
    await expect
      .poll(() => scroll.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    await scroll.evaluate((node) => {
      node.scrollTop = 0;
    });
    await scroll.focus();
    await expect(page.locator("[data-course-reading-host]")).toHaveCount(0);
    await page.locator("#release").dispatchEvent("click");
    await expect(page.locator("[data-course-reading-host]")).toBeVisible();
    await expect(scroll).toBeFocused();
    expect(await scroll.evaluate((node) => node.scrollTop)).toBe(0);
  } finally {
    await browser.close();
  }
}, 30_000);

test("an in-progress programme entrance keeps its animation position through host activation", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.goto(
      `${origin}/materials/step-0?from=%2Fproducts%2Fai-engineering%2Fprogramme`,
    );
    await page
      .getByRole("button", { name: "Вся программа", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    // Hold the real CSS animation at an intermediate frame without a wall-clock wait.
    const before = await dialog.evaluate((node) => {
      const animation = node.getAnimations()[0];
      if (animation === undefined)
        throw new Error("Missing programme entrance animation");
      animation.pause();
      animation.currentTime = 40;
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    });
    await expect(page.locator("[data-course-reading-host]")).toHaveCount(0);
    await page.locator("#release").dispatchEvent("click");
    await expect(page.locator("[data-course-reading-host]")).toBeVisible();
    const after = await dialog.boundingBox();
    expect(after).not.toBeNull();
    if (after === null)
      throw new Error("Transferred programme has no geometry");
    // Transformed rects can differ by floating-point rounding below a thousandth of a pixel.
    for (const coordinate of ["x", "y", "width", "height"] as const)
      expect(after[coordinate]).toBeCloseTo(before[coordinate], 3);
    expect(
      await dialog.evaluate((node) =>
        node.getAnimations().map((animation) => ({
          currentTime: animation.currentTime,
          playState: animation.playState,
        })),
      ),
    ).toEqual([{ currentTime: 40, playState: "paused" }]);
  } finally {
    await browser.close();
  }
}, 30_000);

test("reduced-motion programme stays still through host activation", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    await page.goto(
      `${origin}/materials/step-0?from=%2Fproducts%2Fai-engineering%2Fprogramme`,
    );
    await page
      .getByRole("button", { name: "Вся программа", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    expect(await dialog.evaluate((node) => node.getAnimations().length)).toBe(
      0,
    );
    const before = await dialog.boundingBox();
    await expect(page.locator("[data-course-reading-host]")).toHaveCount(0);
    await page.locator("#release").dispatchEvent("click");
    await expect(page.locator("[data-course-reading-host]")).toBeVisible();
    expect(await dialog.boundingBox()).toEqual(before);
    expect(await dialog.evaluate((node) => node.getAnimations().length)).toBe(
      0,
    );
  } finally {
    await browser.close();
  }
}, 30_000);
