import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  chromium,
  webkit,
  expect as browserExpect,
  type Browser,
} from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, test } from "vitest";

let server: ViteDevServer | undefined;
let baseURL = "";
beforeAll(async () => {
  const html = await readFile(
    new URL("../support/reader-history.html", import.meta.url),
    "utf8",
  );
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../../", import.meta.url)),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "reader-history-pages",
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (
              request.url?.startsWith("/materials/") !== true &&
              request.url?.startsWith("/products/") !== true
            ) {
              next();
              return;
            }
            response.setHeader("content-type", "text/html");
            response.end(html);
          });
        },
      },
    ],
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === undefined || address === null || typeof address === "string")
    throw new Error("Reader history fixture has no address");
  baseURL = `http://127.0.0.1:${String(address.port)}`;
});
afterAll(async () => {
  await server?.close();
});

for (const engine of [chromium, webkit])
  test(`${engine.name()} restores the originating entry through nested documents, reload and explicit return without leaking to another tab`, async () => {
    let browser: Browser | undefined;
    try {
      browser = await engine.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      const source = `${baseURL}/products/course/tasks/start?attemptsAfter=older#submission`;
      await page.goto(source);
      await browserExpect(page.getByRole("heading")).toHaveText(
        "/products/course/tasks/start",
      );
      await page.waitForFunction(() => "readerHistoryReady" in window);
      await page
        .locator("[data-reader-history-root] details")
        .evaluate((element) => {
          if (element instanceof HTMLDetailsElement) element.open = true;
        });
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
      await browserExpect(
        page.locator("[data-reader-history-root] details"),
      ).toHaveAttribute("open", "");
      await browserExpect
        .poll(() =>
          page
            .locator("[data-reader-history-root] [data-course-rail-scroll]")
            .evaluate((element) => element.scrollTop),
        )
        .toBe(100);
      await browserExpect(
        page.locator("section[hidden] details"),
      ).not.toHaveAttribute("open");
    } finally {
      await browser?.close();
    }
  }, 30_000);
