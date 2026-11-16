import { fileURLToPath } from "node:url";
import {
  chromium,
  expect as browserExpect,
  type Browser,
  type Page,
} from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";

const facts = [
  { kind: "profile", path: "/api/account" },
  { kind: "contact", path: "/api/account/billing/contact" },
  { kind: "preferences", path: "/api/account/notifications/preferences" },
  {
    kind: "feedback",
    path: "/api/authoring/product-tasks/awaiting-feedback-count",
  },
] as const;
type Fact = (typeof facts)[number];
function answer(kind: Fact["kind"], revision: number) {
  switch (kind) {
    case "profile":
      return {
        profile: {
          kind: "profile",
          profile: {
            version: revision,
            displayName: "Synthetic reader",
            bio: null,
            avatar: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            status: "active",
          },
        },
        telegramMembership: {
          link: { kind: "unlinked" },
          membership: { kind: "inactive" },
        },
      };
    case "contact":
      return {
        ok: true,
        contact: {
          revision,
          email: "synthetic@example.test",
          verifiedAt: "2026-01-01T00:00:00.000Z",
        },
        documents: [],
      };
    case "preferences":
      return {
        ok: true,
        preferences: { revision, email: true, telegram: false },
      };
    case "feedback":
      return { kind: "ready", count: revision };
  }
}
let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let baseURL = "";
function runningBrowser() {
  if (browser === undefined)
    throw new Error("Account fact browser is not running");
  return browser;
}
beforeAll(async () => {
  server = await createServer({
    configFile: false,
    define: { "process.env": "{}" },
    root: fileURLToPath(new URL("../../", import.meta.url)),
    cacheDir: "node_modules/.cache/account-fact-announcements",
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
      throw new Error("Missing account fact listener");
    baseURL = `http://127.0.0.1:${String(address.port)}/test/support/account-fact-announcements.html`;
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
async function state(page: Page, revision: number) {
  for (const label of ["Primary", "Same cache"])
    await browserExpect(page.getByLabel(label, { exact: true })).toHaveText(
      String(revision),
    );
}
for (const fact of facts) {
  test(`${fact.kind}: an announced write cancels the initial pre-write read in another document`, async () => {
    const context = await runningBrowser().newContext();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => undefined;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    let delivered: () => void = () => undefined;
    const oldDelivered = new Promise<void>((resolve) => {
      delivered = resolve;
    });
    let reads = 0;
    try {
      const writer = await context.newPage();
      await writer.route(`**${fact.path}`, (route) =>
        route.fulfill({ json: answer(fact.kind, 1) }),
      );
      await writer.goto(`${baseURL}?kind=${fact.kind}`);
      await state(writer, 1);
      const reader = await context.newPage();
      await reader.route(`**${fact.path}`, async (route) => {
        const current = ++reads;
        if (current === 1) {
          started();
          await held;
        }
        try {
          await route.fulfill({
            json: answer(fact.kind, current === 1 ? 1 : 2),
          });
        } finally {
          if (current === 1) delivered();
        }
      });
      await reader.goto(`${baseURL}?kind=${fact.kind}`);
      await reading;
      await writer.getByRole("button", { name: "Announce write" }).click();
      // The new read must finish while the old response is still held.
      await state(reader, 2);
      expect(reads).toBe(2);
      release();
      await oldDelivered;
      await state(reader, 2);
      expect(reads).toBe(2);
    } finally {
      release();
      await context.close();
    }
  }, 30_000);

  test(`${fact.kind}: fallback shares each announced read with sibling observers and the writer`, async () => {
    const context = await runningBrowser().newContext();
    let revision = 1;
    let reads = 0;
    try {
      await context.addInitScript(() => {
        Object.defineProperty(window, "BroadcastChannel", { value: undefined });
      });
      const page = await context.newPage();
      await page.route(`**${fact.path}`, (route) => {
        reads++;
        return route.fulfill({ json: answer(fact.kind, revision) });
      });
      await page.goto(`${baseURL}?kind=${fact.kind}&secondary=1`);
      await state(page, 1);
      await browserExpect(
        page.getByLabel("Independent cache", { exact: true }),
      ).toHaveText("1");
      expect(reads).toBe(2);
      revision = 2;
      await page.getByRole("button", { name: "Announce write" }).click();
      await state(page, 2);
      await browserExpect(
        page.getByLabel("Independent cache", { exact: true }),
      ).toHaveText("2");
      expect(reads).toBe(4);
    } finally {
      await context.close();
    }
  }, 30_000);
}
