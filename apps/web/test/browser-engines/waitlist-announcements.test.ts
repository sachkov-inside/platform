import { fileURLToPath } from "node:url";
import {
  chromium,
  expect as browserExpect,
  type Browser,
  type Page,
} from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";

const accountA = "00000000-0000-4000-8000-000000000001";
const accountB = "00000000-0000-4000-8000-000000000002";
const productA = "10000000-0000-4000-8000-000000000001";
const productB = "10000000-0000-4000-8000-000000000002";
let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let baseURL = "";
function runningBrowser() {
  if (browser === undefined) throw new Error("Waitlist browser is not running");
  return browser;
}
function answer(accountId: string, productId: string, active: boolean) {
  return {
    kind: "ready",
    accountId,
    intakeId: productId,
    name: "Test intake",
    active,
    continuation: false,
  };
}
beforeAll(async () => {
  server = await createServer({
    configFile: false,
    define: { "process.env": "{}" },
    root: fileURLToPath(new URL("../../", import.meta.url)),
    cacheDir: "node_modules/.cache/waitlist-announcements",
    resolve: {
      alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
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
      throw new Error("Missing waitlist listener");
    baseURL = `http://127.0.0.1:${String(address.port)}/test/support/waitlist-announcements.html`;
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
async function state(
  page: Page,
  account: string,
  product: string,
  active: boolean,
) {
  await browserExpect(page.getByLabel("Primary", { exact: true })).toHaveText(
    `${account}:${product}:${String(active)}`,
  );
  await browserExpect(
    page.getByLabel("Same cache", { exact: true }),
  ).toHaveText(`${account}:${product}:${String(active)}`);
}

test("waitlist writes refresh another document and share one read for sibling observers", async () => {
  const context = await runningBrowser().newContext();
  let active = false;
  const reads = new Map<Page, number>();
  try {
    const pages = [await context.newPage(), await context.newPage()];
    for (const page of pages) {
      reads.set(page, 0);
      await page.route("**/api/product-waitlist?*", async (route) => {
        reads.set(page, (reads.get(page) ?? 0) + 1);
        await route.fulfill({ json: answer(accountA, productA, active) });
      });
      await page.goto(baseURL);
      await state(page, accountA, productA, false);
    }
    const writer = pages[0];
    if (writer === undefined) throw new Error("Missing writer");
    active = true;
    await writer.getByRole("button", { name: "Announce write" }).click();
    for (const page of pages) {
      await state(page, accountA, productA, true);
      expect(reads.get(page)).toBe(2);
    }
  } finally {
    await context.close();
  }
}, 30_000);

test("without BroadcastChannel waitlist writes refresh independent caches in the same document", async () => {
  const context = await runningBrowser().newContext();
  let active = false;
  let reads = 0;
  try {
    await context.addInitScript(() => {
      Object.defineProperty(window, "BroadcastChannel", { value: undefined });
    });
    const page = await context.newPage();
    await page.route("**/api/product-waitlist?*", async (route) => {
      reads += 1;
      await route.fulfill({ json: answer(accountA, productA, active) });
    });
    await page.goto(`${baseURL}?secondary=1`);
    await state(page, accountA, productA, false);
    await browserExpect(
      page.getByLabel("Independent cache", { exact: true }),
    ).toHaveText(`${accountA}:${productA}:false`);
    active = true;
    await page.getByRole("button", { name: "Announce write" }).click();
    await state(page, accountA, productA, true);
    await browserExpect(
      page.getByLabel("Independent cache", { exact: true }),
    ).toHaveText(`${accountA}:${productA}:true`);
    expect(reads).toBe(4);
  } finally {
    await context.close();
  }
}, 30_000);

test("waitlist Account and Product changes never reuse another scope's cached membership", async () => {
  const context = await runningBrowser().newContext();
  let account = accountA;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started: () => void = () => undefined;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  let delivered: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  try {
    const page = await context.newPage();
    await page.route("**/api/product-waitlist?*", async (route) => {
      const product =
        new URL(route.request().url()).searchParams.get("productId") ?? "";
      const snapshot = answer(account, product, account === accountA);
      if (account === accountB && product === productA) {
        started();
        await held;
      }
      await route.fulfill({ json: snapshot });
      if (snapshot.accountId === accountB && product === productA) delivered();
    });
    await page.goto(baseURL);
    await state(page, accountA, productA, true);
    account = accountB;
    await page.getByRole("button", { name: "Switch Account" }).click();
    await reading;
    await browserExpect(page.getByLabel("Primary", { exact: true })).toHaveText(
      "loading",
    );
    await page.getByRole("button", { name: "Switch Product" }).click();
    await state(page, accountB, productB, false);
    release();
    await settled;
    await state(page, accountB, productB, false);
  } finally {
    release();
    await context.close();
  }
}, 30_000);
