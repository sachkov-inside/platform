import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, test } from "vitest";

let server: ViteDevServer;
let origin: string;
beforeAll(async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  server = await createServer({
    configFile: false,
    root,
    oxc: { jsx: { runtime: "automatic" } },
    resolve: {
      alias: {
        "@": `${root}/src`,
        "next/navigation": `${root}/test/support/course-reading-router.ts`,
        "next/link": `${root}/.storybook/mocks/next-link.tsx`,
      },
    },
    server: { host: "127.0.0.1", port: 0 },
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
  await server.close();
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
  } finally {
    await browser.close();
  }
}, 30_000);

for (const width of [390, 820])
  test(`width ${String(width)} retains the early open programme, chapter expansion, focus and scroll`, async () => {
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
      const first = dialog.locator('details[data-course-chapter-id="first"]');
      await first.locator("summary").click();
      const second = dialog.locator('details[data-course-chapter-id="second"]');
      await second.locator("summary").click();
      await second.getByRole("button", { name: "Показать ещё" }).click();
      const collapse = second.getByRole("button", { name: "Скрыть" });
      await expect(collapse).toBeFocused();
      const position = await dialog.evaluate((node) => {
        node.scrollTop -= 24;
        return node.scrollTop;
      });
      expect(position).toBeGreaterThan(0);
      await expect(page.locator("[data-course-reading-host]")).toHaveCount(0);
      await page.locator("#release").dispatchEvent("click");
      await expect(page.locator("[data-course-reading-host]")).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(second).toHaveAttribute("open", "");
      await expect(first).not.toHaveAttribute("open");
      await expect(collapse).toHaveAttribute("aria-expanded", "true");
      await expect(collapse).toBeFocused();
      expect(await dialog.evaluate((node) => node.scrollTop)).toBe(position);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    } finally {
      await browser.close();
    }
  }, 30_000);
