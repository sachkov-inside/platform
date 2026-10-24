import { fileURLToPath } from "node:url";
import {
  chromium,
  expect as browserExpect,
  type Browser,
} from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";
let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let baseURL: string;
beforeAll(async () => {
  server = await createServer({
    configFile: false,
    define: { "process.env": "{}" },
    cacheDir: "node_modules/.cache/optional-analytics",
    root: fileURLToPath(new URL("../../", import.meta.url)),
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("../../src", import.meta.url)),
        "next/link": fileURLToPath(
          new URL("../../.storybook/mocks/next-link.tsx", import.meta.url),
        ),
      },
    },
    oxc: { jsx: { runtime: "automatic" } },
    server: { host: "127.0.0.1", port: 0 },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (
      address === null ||
      address === undefined ||
      typeof address === "string"
    )
      throw new Error("Missing analytics listener");
    baseURL = `http://127.0.0.1:${String(address.port)}/test/support/analytics-flow.html`;
    browser = await chromium.launch();
  } catch (error) {
    await server.close();
    throw error;
  }
}, 30_000);
afterAll(async () => {
  try {
    await browser?.close();
  } finally {
    await server?.close();
  }
});
test("real browser choice persists, refuses and revokes in two tabs before any further capture", async () => {
  if (browser === undefined) throw new Error("Missing browser");
  const context = await browser.newContext();
  const captured: unknown[] = [];
  try {
    await context.route("**/api/analytics", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: { enabled: true, revision: "3" } });
      captured.push(route.request().postDataJSON());
      return route.fulfill({ json: { accepted: true } });
    });
    const page = await context.newPage();
    await page.goto(
      `${baseURL}?utm_source=telegram&email=secret@example.com#token`,
    );
    await browserExpect(
      page.getByRole("region", { name: "Cookies и аналитика" }),
    ).toBeVisible();
    expect(captured).toEqual([]);
    await page
      .getByRole("button", { name: "Только необходимые", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Открыть материал", exact: true })
      .click();
    await browserExpect(page.getByRole("status")).toHaveText("material_view");
    expect(captured).toEqual([]);
    await page
      .getByRole("button", { name: "Настройки cookies и аналитики" })
      .click();
    const allowed = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith("/api/analytics"),
    );
    await page.getByRole("button", { name: "Разрешить", exact: true }).click();
    await allowed;
    await browserExpect.poll(() => captured.length).toBe(1);
    expect(captured[0]).toEqual({
      revision: "3",
      event: "material_view",
      campaign: "telegram",
      referrer: "direct",
    });
    const second = await context.newPage();
    const reloaded = second.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith("/api/analytics"),
    );
    await second.goto(baseURL);
    await reloaded;
    await browserExpect.poll(() => captured.length).toBe(2);
    await browserExpect(
      second.getByRole("region", { name: "Cookies и аналитика" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Настройки cookies и аналитики" })
      .click();
    await page
      .getByRole("button", { name: "Только необходимые", exact: true })
      .click();
    await browserExpect
      .poll(() =>
        second.evaluate(() =>
          localStorage.getItem("inside.analytics-choice.v1"),
        ),
      )
      .toBe('{"revision":"3","choice":"necessary"}');
    await second
      .getByRole("button", { name: "Закрытый материал", exact: true })
      .click();
    await browserExpect(second.getByRole("status")).toHaveText(
      "access_restricted",
    );
    await page.getByRole("button", { name: "К покупке", exact: true }).click();
    await browserExpect(page.getByRole("status")).toHaveText(
      "checkout_started",
    );
    expect(captured).toHaveLength(2);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([
      "inside.analytics-choice.v1",
    ]);
  } finally {
    await context.close();
  }
}, 30_000);
test("disabled runtime keeps the existing necessary-storage notice and sends no events", async () => {
  if (browser === undefined) throw new Error("Missing browser");
  const context = await browser.newContext();
  try {
    const writes: string[] = [];
    await context.route("**/api/analytics", async (route) => {
      if (route.request().method() === "POST")
        writes.push(route.request().url());
      await route.fulfill({ json: { enabled: false } });
    });
    const page = await context.newPage();
    await page.goto(baseURL);
    await browserExpect(
      page.getByRole("button", { name: "Понятно", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Понятно", exact: true }).click();
    await page
      .getByRole("button", { name: "Открыть материал", exact: true })
      .click();
    await browserExpect(page.getByRole("status")).toHaveText("material_view");
    await browserExpect(
      page.getByRole("button", { name: "Настройки cookies и аналитики" }),
    ).toHaveCount(0);
    expect(writes).toEqual([]);
  } finally {
    await context.close();
  }
}, 30_000);

test("a failed storage write cannot leave a previous allowance active after revocation", async () => {
  if (browser === undefined) throw new Error("Missing browser");
  const context = await browser.newContext();
  try {
    let sent = 0;
    await context.route("**/api/analytics", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: { enabled: true, revision: "3" } });
      sent++;
      return route.fulfill({ json: { accepted: true } });
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem(
        "inside.analytics-choice.v1",
        '{"revision":"3","choice":"allowed"}',
      );
    });
    const initial = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith("/api/analytics"),
    );
    await page.goto(baseURL);
    await initial;
    await browserExpect.poll(() => sent).toBe(1);
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("blocked", "SecurityError");
      };
    });
    await page
      .getByRole("button", { name: "Настройки cookies и аналитики" })
      .click();
    await page
      .getByRole("button", { name: "Только необходимые", exact: true })
      .click();
    await browserExpect(
      page.getByText(/Не удалось сохранить выбор/),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Открыть материал", exact: true })
      .click();
    await browserExpect(
      page.getByRole("main").getByRole("status").first(),
    ).toHaveText("material_view");
    expect(sent).toBe(1);
  } finally {
    await context.close();
  }
}, 30_000);
