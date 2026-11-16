import { fileURLToPath } from "node:url";
import {
  chromium,
  expect as browserExpect,
  type Browser,
  type Page,
} from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";

const account = "00000000-0000-4000-8000-000000000001";
const authenticated = {
  state: "authenticated",
  accountId: account,
  canManageMaterials: true,
};
const guest = { state: "guest", accountId: null, canManageMaterials: false };
function barrier() {
  let release: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pending, release };
}
let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let baseURL = "";
function runningBrowser() {
  if (browser === undefined)
    throw new Error("Auth status browser is not running");
  return browser;
}
beforeAll(async () => {
  server = await createServer({
    configFile: false,
    define: { "process.env": "{}" },
    root: fileURLToPath(new URL("../../", import.meta.url)),
    cacheDir: "node_modules/.cache/auth-status",
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
      address === undefined ||
      address === null ||
      typeof address === "string"
    )
      throw new Error("Missing auth status listener");
    baseURL = `http://127.0.0.1:${String(address.port)}/test/support/auth-status.html`;
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
async function status(
  page: Page,
  state: string,
  id = "none",
  manager = false,
  resolved = true,
) {
  for (const [label, text] of [
    ["State", state],
    ["Account", id],
    ["Manager", String(manager)],
    ["Resolved", String(resolved)],
  ] as const)
    await browserExpect(page.getByLabel(label, { exact: true })).toHaveText(
      text,
    );
}

test("auth begins unresolved and keeps known status during a newer return check", async () => {
  const context = await runningBrowser().newContext();
  const initial = barrier();
  const returning = barrier();
  const returnStarted = barrier();
  let reads = 0;
  try {
    const page = await context.newPage();
    await page.route("**/auth/status", async (route) => {
      const number = ++reads;
      if (number === 1) await initial.pending;
      else {
        returnStarted.release();
        await returning.pending;
      }
      await route.fulfill({ json: number === 1 ? authenticated : guest });
    });
    await page.goto(baseURL);
    await status(page, "guest", "none", false, false);
    initial.release();
    await status(page, "authenticated", account, true);
    await page.getByRole("button", { name: "Return focus" }).click();
    await returnStarted.pending;
    await status(page, "authenticated", account, true);
    returning.release();
    await status(page, "guest");
    expect(reads).toBe(2);
  } finally {
    initial.release();
    returning.release();
    await context.close();
  }
}, 30_000);

test("the latest auth return wins over a late pre-sign-out reply", async () => {
  const context = await runningBrowser().newContext();
  const held = barrier();
  const started = barrier();
  const delivered = barrier();
  let reads = 0;
  try {
    const page = await context.newPage();
    await page.route("**/auth/status", async (route) => {
      const number = ++reads;
      if (number === 2) {
        started.release();
        await held.pending;
      }
      try {
        await route.fulfill({ json: number === 3 ? guest : authenticated });
      } finally {
        if (number === 2) delivered.release();
      }
    });
    await page.goto(baseURL);
    await status(page, "authenticated", account, true);
    await page.getByRole("button", { name: "Return focus" }).click();
    await started.pending;
    await page.getByRole("button", { name: "Return focus" }).click();
    await status(page, "guest");
    held.release();
    await delivered.pending;
    await status(page, "guest");
    expect(reads).toBe(3);
  } finally {
    held.release();
    await context.close();
  }
}, 30_000);

test("only a persisted pageshow repeats the auth check", async () => {
  const context = await runningBrowser().newContext();
  let reads = 0;
  try {
    const page = await context.newPage();
    await page.route("**/auth/status", (route) => {
      reads++;
      return route.fulfill({ json: reads === 1 ? authenticated : guest });
    });
    await page.goto(baseURL);
    await status(page, "authenticated", account, true);
    await page.getByRole("button", { name: "Initial pageshow" }).click();
    expect(reads).toBe(1);
    await page.getByRole("button", { name: "Restored pageshow" }).click();
    await status(page, "guest");
    expect(reads).toBe(2);
  } finally {
    await context.close();
  }
}, 30_000);

test("unmounted auth ignores returns and a remount starts unresolved despite the old cache", async () => {
  const context = await runningBrowser().newContext();
  const held = barrier();
  const started = barrier();
  let reads = 0;
  try {
    const page = await context.newPage();
    await page.route("**/auth/status", async (route) => {
      const number = ++reads;
      if (number === 2) {
        started.release();
        await held.pending;
      }
      await route.fulfill({ json: number === 1 ? authenticated : guest });
    });
    await page.goto(baseURL);
    await status(page, "authenticated", account, true);
    await page.getByRole("button", { name: "Unmount" }).click();
    await browserExpect(page.getByLabel("State", { exact: true })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Return focus" }).click();
    expect(reads).toBe(1);
    await page.getByRole("button", { name: "Mount", exact: true }).click();
    await started.pending;
    await status(page, "guest", "none", false, false);
    held.release();
    await status(page, "guest");
    expect(reads).toBe(2);
  } finally {
    held.release();
    await context.close();
  }
}, 30_000);

test("auth failures clear rights and malformed fields cannot claim an Account", async () => {
  const context = await runningBrowser().newContext();
  let reads = 0;
  try {
    const page = await context.newPage();
    await page.route("**/auth/status", async (route) => {
      const number = ++reads;
      if (number === 3) await route.abort("failed");
      else
        await route.fulfill({
          json:
            number === 1 || number === 4
              ? authenticated
              : number === 2
                ? {
                    state: "authenticated",
                    accountId: "wrong",
                    canManageMaterials: "yes",
                  }
                : {
                    state: "unrecognized",
                    accountId: account,
                    canManageMaterials: true,
                  },
        });
    });
    await page.goto(baseURL);
    await status(page, "authenticated", account, true);
    await page.getByRole("button", { name: "Return focus" }).click();
    await status(page, "authenticated");
    await page.getByRole("button", { name: "Return focus" }).click();
    await status(page, "unavailable");
    await page.getByRole("button", { name: "Return focus" }).click();
    await status(page, "authenticated", account, true);
    await page.getByRole("button", { name: "Return focus" }).click();
    await status(page, "unavailable");
    expect(reads).toBe(5);
  } finally {
    await context.close();
  }
}, 30_000);

test("an offline return reports unavailable instead of retaining authenticated rights indefinitely", async () => {
  const context = await runningBrowser().newContext();
  let offline = false;
  try {
    const page = await context.newPage();
    await page.route("**/auth/status", (route) =>
      offline ? route.continue() : route.fulfill({ json: authenticated }),
    );
    await page.goto(baseURL);
    await status(page, "authenticated", account, true);
    await context.setOffline(true);
    await browserExpect
      .poll(() => page.evaluate(() => navigator.onLine))
      .toBe(false);
    offline = true;
    await page.getByRole("button", { name: "Return focus" }).click();
    await status(page, "unavailable");
  } finally {
    await context.close();
  }
}, 30_000);
