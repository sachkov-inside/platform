import { fileURLToPath } from "node:url";
import {
  chromium,
  expect as browserExpect,
  type Browser,
  type Page,
} from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";

let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let baseURL: string;
function runningBrowser(): Browser {
  if (browser === undefined)
    throw new Error("Browser facts browser is not running");
  return browser;
}
const accountA = "00000000-0000-4000-8000-000000000001";
const materialId = "10000000-0000-4000-8000-000000000001";
const material = {
  materialId,
  access: "free",
  availability: "available",
  cover: null,
  format: "Статья",
  formatSlug: "article",
  productMemberships: [],
  slug: "saved",
  summary: "Saved material",
  tags: [],
  title: "Saved for Account A",
  topic: "Архитектура",
  topicSlug: "architecture",
};

function readingFixture() {
  const state = { isRead: false, version: 0 };
  const attach = async (page: Page, secondary = false) => {
    await page.route("**/api/reading-progress/*", async (route) => {
      const write =
        new URL(route.request().url()).pathname ===
        "/api/reading-progress/state";
      if (write) {
        state.isRead = z
          .object({ isRead: z.boolean() })
          .parse(route.request().postDataJSON()).isRead;
        state.version += 1;
      }
      const snapshot = {
        materialId,
        ...state,
        readAt: state.isRead ? "2030-01-01T00:00:00.000Z" : null,
        updatedAt: state.version === 0 ? null : "2030-01-01T00:00:00.000Z",
      };
      await route.fulfill({
        json: write
          ? { kind: "saved", state: snapshot, replayed: false }
          : { kind: "ready", states: [snapshot] },
      });
    });
    await page.goto(`${baseURL}?reading=1${secondary ? "&secondary=1" : ""}`);
    const read = page
      .getByRole("region", { name: "Reading action", exact: true })
      .getByRole("button", { name: "Изучено", exact: true });
    await browserExpect(read).toHaveAttribute("aria-disabled", "false");
    await browserExpect(read).toHaveAttribute("aria-pressed", "false");
    return read;
  };
  return { attach };
}

test("mark and unmark update reading state in a second open document without reload or focus", async () => {
  const context = await runningBrowser().newContext();
  try {
    const { attach } = readingFixture();
    const writer = await context.newPage();
    const reader = await context.newPage();
    const write = await attach(writer);
    const read = await attach(reader);
    for (const desired of [true, false]) {
      await write.click();
      await browserExpect(write).toHaveAttribute(
        "aria-pressed",
        String(desired),
      );
      await browserExpect(read).toHaveAttribute(
        "aria-pressed",
        String(desired),
      );
    }
  } finally {
    await context.close();
  }
}, 30_000);

test("without BroadcastChannel reading writes update independent caches in the same document", async () => {
  const context = await runningBrowser().newContext();
  try {
    await context.addInitScript(() => {
      Reflect.deleteProperty(globalThis, "BroadcastChannel");
    });
    const { attach } = readingFixture();
    const writer = await context.newPage();
    const reader = await context.newPage();
    const write = await attach(writer, true);
    const otherDocument = await attach(reader);
    const localReader = writer
      .getByRole("region", { name: "Secondary reading action", exact: true })
      .getByRole("button", { name: "Изучено", exact: true });
    await browserExpect(localReader).toHaveAttribute("aria-pressed", "false");
    for (const desired of [true, false]) {
      await write.click();
      await browserExpect(write).toHaveAttribute(
        "aria-pressed",
        String(desired),
      );
      await browserExpect(localReader).toHaveAttribute(
        "aria-pressed",
        String(desired),
      );
      // No cross-document transport is available; the fresh recipient cache is unchanged.
      await browserExpect(otherDocument).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
  } finally {
    await context.close();
  }
}, 30_000);

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    define: { "process.env": "{}" },
    cacheDir: "node_modules/.cache/browser-facts",
    root: fileURLToPath(new URL("../../", import.meta.url)),
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
      throw new Error("Missing browser facts listener");
    baseURL = `http://127.0.0.1:${String(address.port)}/test/support/browser-facts.html`;
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

function fixture(billing?: (page: Page) => Promise<void>) {
  const state = { saved: false, account: accountA };
  const attach = async (
    page: Page,
    { waitForEmpty = true, secondary = false } = {},
  ) => {
    await page.route(
      (url) => url.pathname.startsWith("/api/bookmarks"),
      async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/bookmarks/state")
          state.saved = z
            .object({ bookmarked: z.boolean() })
            .parse(route.request().postDataJSON()).bookmarked;
        const saved = state.saved && state.account === accountA;
        await route.fulfill({
          json:
            path === "/api/bookmarks"
              ? { items: saved ? [material] : [], nextCursor: null }
              : path === "/api/bookmarks/state"
                ? {
                    kind: "ready",
                    state: {
                      materialId,
                      bookmarked: saved,
                      bookmarkedAt: saved ? "2030-01-01T00:00:00.000Z" : null,
                    },
                  }
                : {
                    kind: "ready",
                    states: [
                      {
                        materialId,
                        bookmarked: saved,
                        bookmarkedAt: saved ? "2030-01-01T00:00:00.000Z" : null,
                      },
                    ],
                  },
        });
      },
    );
    await billing?.(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(baseURL + (secondary ? "?secondary=1" : ""));
    try {
      await browserExpect(
        page
          .getByRole("region", { name: "Bookmark action" })
          .getByRole("button", { name: "В закладки", exact: true }),
      ).toHaveAttribute("aria-disabled", "false");
      if (waitForEmpty)
        await browserExpect(
          page
            .getByRole("region", { name: "Bookmark list", exact: true })
            .getByRole("heading", { name: "Пока пусто" }),
        ).toBeVisible();
    } catch (error) {
      throw new Error(
        errors.join("\n") + (await page.locator("body").innerText()),
        { cause: error },
      );
    }
  };
  return { state, attach };
}

test("bookmark writes reach a second open document without reload or focus", async () => {
  const context = await runningBrowser().newContext();
  try {
    const { attach } = fixture();
    const writer = await context.newPage();
    const reader = await context.newPage();
    await attach(writer);
    await attach(reader);
    const action = writer.getByRole("region", { name: "Bookmark action" });
    await action
      .getByRole("button", { name: "В закладки", exact: true })
      .click();
    await browserExpect(
      action.getByRole("button", { name: "В закладках", exact: true }),
    ).toBeVisible();
    await browserExpect(
      reader.getByRole("link", { name: /Saved for Account A/u }),
    ).toBeVisible();
    await browserExpect(
      reader.getByRole("button", { name: "В закладках", exact: true }),
    ).toBeVisible();
    await action
      .getByRole("button", { name: "В закладках", exact: true })
      .click();
    await browserExpect(
      reader.getByRole("heading", { name: "Пока пусто" }),
    ).toBeVisible();
    await browserExpect(
      reader.getByRole("button", { name: "В закладки", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
}, 30_000);

test("Account B cannot display Account A's cached bookmarks while its reads are pending", async () => {
  const context = await runningBrowser().newContext();
  try {
    const { attach, state } = fixture();
    const page = await context.newPage();
    await attach(page);
    await page.getByRole("button", { name: "В закладки", exact: true }).click();
    await browserExpect(
      page.getByRole("link", { name: /Saved for Account A/u }),
    ).toBeVisible();
    state.account = "00000000-0000-4000-8000-000000000002";
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      (url) => url.pathname.startsWith("/api/bookmarks"),
      async (route) => {
        await held;
        await route.fallback();
      },
    );
    try {
      await page.getByRole("button", { name: "Switch Account" }).click();
      await browserExpect(
        page.getByRole("region", { name: "Bookmark list" }).getByRole("status"),
      ).toHaveText("Загружаем закладки…");
      await browserExpect(
        page.getByRole("link", { name: /Saved for Account A/u }),
      ).toHaveCount(0);
      await browserExpect(
        page.getByRole("button", { name: "В закладках", exact: true }),
      ).toHaveCount(0);
    } finally {
      release();
    }
    await browserExpect(
      page.getByRole("heading", { name: "Пока пусто" }),
    ).toBeVisible();
    await browserExpect(
      page.getByRole("button", { name: "В закладки", exact: true }),
    ).toHaveAttribute("aria-disabled", "false");
  } finally {
    await context.close();
  }
}, 30_000);

test("without BroadcastChannel bookmark writes update the list in the same document", async () => {
  const context = await runningBrowser().newContext();
  try {
    await context.addInitScript(() => {
      Reflect.deleteProperty(globalThis, "BroadcastChannel");
    });
    const page = await context.newPage();
    await fixture().attach(page, { secondary: true });
    const reader = page.getByRole("region", {
      name: "Secondary bookmark list",
      exact: true,
    });
    await browserExpect(
      reader.getByRole("heading", { name: "Пока пусто" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "В закладки", exact: true }).click();
    await browserExpect(
      reader.getByRole("link", { name: /Saved for Account A/u }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "В закладках", exact: true })
      .click();
    await browserExpect(
      reader.getByRole("heading", { name: "Пока пусто" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
}, 30_000);

test("a write supersedes an initial bookmark read that captured the old answer", async () => {
  const context = await runningBrowser().newContext();
  let release: () => void = () => undefined;
  try {
    const writer = await context.newPage();
    const reader = await context.newPage();
    let started: () => void = () => undefined;
    const initialRead = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let postWriteStarted: () => void = () => undefined;
    const postWriteRead = new Promise<void>((resolve) => {
      postWriteStarted = resolve;
    });
    let first = true;
    const { attach } = fixture(async (page) => {
      if (page !== reader) return;
      await page.route(
        (url) => url.pathname === "/api/bookmarks",
        async (route) => {
          if (!first) {
            postWriteStarted();
            await route.fallback();
            return;
          }
          first = false;
          started();
          await held;
          await route.fulfill({ json: { items: [], nextCursor: null } });
        },
      );
    });
    await attach(writer);
    await attach(reader, { waitForEmpty: false });
    await initialRead;
    await writer
      .getByRole("button", { name: "В закладки", exact: true })
      .click();
    await browserExpect(
      writer.getByRole("button", { name: "В закладках", exact: true }),
    ).toBeVisible();
    await postWriteRead;
    release();
    await browserExpect(
      reader.getByRole("link", { name: /Saved for Account A/u }),
    ).toBeVisible();
  } finally {
    release();
    await context.close();
  }
}, 30_000);

test("two reading surfaces share one fact channel while both receive a write", async () => {
  const context = await runningBrowser().newContext();
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      const NativeChannel = BroadcastChannel;
      let opened = 0;
      let closed = 0;
      Reflect.set(window, "factChannelCounts", () => ({ opened, closed }));
      window.BroadcastChannel = class extends NativeChannel {
        constructor(name: string) {
          super(name);
          opened += 1;
        }
        override close() {
          closed += 1;
          super.close();
        }
      };
    });
    const { attach } = readingFixture();
    const write = await attach(page, true);
    const other = page
      .getByRole("region", { name: "Secondary reading action", exact: true })
      .getByRole("button", { name: "Изучено", exact: true });
    await browserExpect(other).toHaveAttribute("aria-disabled", "false");
    const counts = () =>
      page.evaluate(() => {
        const read: unknown = Reflect.get(window, "factChannelCounts");
        if (typeof read !== "function")
          throw new Error("Fact transport probe is required");
        return Reflect.apply(read, undefined, []) as unknown;
      });
    browserExpect(await counts()).toEqual({ opened: 1, closed: 0 });
    await write.click();
    await browserExpect(write).toHaveAttribute("aria-pressed", "true");
    await browserExpect(other).toHaveAttribute("aria-pressed", "true");
    browserExpect(await counts()).toEqual({ opened: 2, closed: 1 });
  } finally {
    await context.close();
  }
});

test("Product community cache never shows Account A's group while Account B is being checked", async () => {
  const page = await runningBrowser().newPage();
  let release: (() => void) | undefined;
  let requests = 0;
  try {
    await page.route("**/api/account/community-entry?*", async (route) => {
      requests += 1;
      if (requests === 1)
        return route.fulfill({
          json: {
            ok: true,
            value: {
              kind: "member",
              groupUrl: "https://t.me/c/123456789/1",
            },
          },
        });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ json: { ok: true, value: { kind: "none" } } });
    });
    await page.goto(`${baseURL}?community=1`);
    await browserExpect(
      page.getByRole("link", { name: "Открыть сообщество" }),
    ).toBeVisible();
    const requestB = page.waitForRequest("**/api/account/community-entry?*");
    await page.getByRole("button", { name: "Switch Account" }).click();
    await requestB;
    await browserExpect(
      page.getByRole("link", { name: "Открыть сообщество" }),
    ).toHaveCount(0);
    release?.();
    await browserExpect(page.locator("[data-product-community]")).toBeEmpty();
    expect(requests).toBe(2);
  } finally {
    release?.();
    await page.close();
  }
});

const accessProductId = "10000000-0000-4000-8000-000000000009";

/** The person card BFF answer for one Product in the given access state. */
function personCard(access: "active" | "revoked", revision: number) {
  return {
    kind: "ready",
    card: {
      person: {
        accountId: accountA,
        displayName: "Анна Петрова",
        username: null,
        email: null,
        contactsState: "complete",
        registeredAt: "2030-01-01T00:00:00Z",
        telegramUrl: null,
      },
      products: {
        state: "ready",
        items: [
          {
            productId: accessProductId,
            name: "Test Product",
            access,
            revision,
            firstIssuedAt: "2030-01-01T00:00:00Z",
            origin: "manual",
            history: [],
          },
        ],
      },
      payments: { state: "unavailable" },
      learning: { state: "unavailable" },
      submissions: { state: "unavailable" },
      telegram: { state: "unavailable" },
      waitlists: { state: "unavailable" },
    },
  };
}

/** The Product block of one card surface: its badge says the access state. */
function productPanel(page: Page, surface: string) {
  return page
    .getByRole("region", { name: surface })
    .getByRole("article", { name: "Test Product" });
}

test("a Product access write in one person card refreshes a second card and the cabinet without losing its draft", async () => {
  const context = await runningBrowser().newContext();
  let access: "active" | "revoked" = "revoked";
  let revision = 2;
  const attach = async (page: Page) => {
    await page.route("**/api/authoring/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === `/api/authoring/people/${accountA}`) {
        await route.fulfill({ json: personCard(access, revision) });
        return;
      }
      if (path.endsWith("/people/product-choices")) {
        await route.fulfill({
          json: {
            kind: "ready",
            products: [
              {
                productId: accessProductId,
                name: "Test Product",
                archived: false,
              },
            ],
          },
        });
        return;
      }
      const record = () => ({
        accountId: accountA,
        productId: accessProductId,
        access,
        revision,
        firstIssuedAt: "2030-01-01T00:00:00Z",
      });
      if (path.endsWith("/preview-revoke")) {
        await route.fulfill({
          json: {
            ok: true,
            value: {
              ok: true,
              value: {
                accountId: accountA,
                productId: accessProductId,
                revision,
                affectedCount: 1,
                affected: [],
                community: "closes",
              },
            },
          },
        });
        return;
      }
      if (path.endsWith("/restore")) {
        access = "active";
        revision += 1;
      }
      if (path.endsWith("/revoke")) {
        access = "revoked";
        revision += 1;
      }
      await route.fulfill({
        json: { ok: true, value: { ok: true, value: record() } },
      });
    });
    await page.goto(`${baseURL}?productAccess=1`);
    await browserExpect(
      productPanel(page, "Primary access").getByText("Доступ отозван"),
    ).toBeVisible();
  };
  try {
    const writer = await context.newPage();
    const reader = await context.newPage();
    await attach(writer);
    await attach(reader);
    const cabinet = await context.newPage();
    await cabinet.route("**/api/account/billing", (route) =>
      route.fulfill({
        json: {
          ok: true,
          value: {
            products: [
              {
                id: accessProductId,
                slug: "test-product",
                name: "Test Product",
                materials: {
                  state: access === "active" ? "available" : "revoked",
                },
                community: { state: "unavailable" },
              },
            ],
            access: { grounds: [] },
            notices: [],
            payments: [],
          },
        },
      }),
    );
    await cabinet.goto(`${baseURL}?billing=1`);
    await browserExpect(
      cabinet.getByText("Доступ отозван", { exact: true }),
    ).toBeVisible();

    // The reader keeps an unsent grant draft open while the writer restores access.
    await reader
      .getByRole("region", { name: "Primary access" })
      .getByRole("button", { name: "Выдать продукт" })
      .click();
    const draft = reader.getByRole("dialog", { name: "Выдать продукт" });
    await draft.getByLabel("Заметка").fill("Unsaved reason");

    await productPanel(writer, "Primary access")
      .getByRole("button", { name: "Восстановить доступ к «Test Product»" })
      .click();
    const restore = writer.getByRole("dialog", {
      name: "Восстановить доступ к «Test Product»",
    });
    await restore.getByLabel("Причина").fill("Restoration");
    await restore.getByRole("button", { name: "Восстановить доступ" }).click();
    await browserExpect(
      writer.getByText("Доступ к «Test Product» восстановлен."),
    ).toBeVisible();
    await browserExpect(
      cabinet.getByText("Доступ открыт", { exact: true }),
    ).toBeVisible();
    await browserExpect(draft.getByLabel("Заметка")).toHaveValue(
      "Unsaved reason",
    );
    await draft.getByRole("button", { name: "Отмена" }).click();
    await browserExpect(
      productPanel(reader, "Primary access").getByText("Доступ открыт"),
    ).toBeVisible();

    await productPanel(writer, "Primary access")
      .getByRole("button", { name: "Отозвать доступ к «Test Product»" })
      .click();
    const revoke = writer.getByRole("dialog", {
      name: "Отозвать доступ к «Test Product»?",
    });
    await browserExpect(
      revoke.getByText("Материалы продукта закроются."),
    ).toBeVisible();
    await revoke.getByRole("radio", { name: "Возврат оплаты" }).check();
    await revoke.getByRole("button", { name: "Отозвать доступ" }).click();
    await browserExpect(
      productPanel(reader, "Primary access").getByText("Доступ отозван"),
    ).toBeVisible();
    await browserExpect(
      cabinet.getByText("Доступ отозван", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
}, 30_000);

test("a denied access write emits no fact; fallback updates a second cache in the same document", async () => {
  const context = await runningBrowser().newContext();
  try {
    await context.addInitScript(() => {
      Reflect.deleteProperty(globalThis, "BroadcastChannel");
    });
    const page = await context.newPage();
    let active = false;
    let deny = true;
    await page.route("**/api/authoring/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === `/api/authoring/people/${accountA}`) {
        await route.fulfill({
          json: personCard(active ? "active" : "revoked", active ? 3 : 2),
        });
        return;
      }
      if (path.endsWith("/people/product-choices")) {
        await route.fulfill({ json: { kind: "ready", products: [] } });
        return;
      }
      if (path.endsWith("/restore") && deny) {
        await route.fulfill({ json: { ok: false, code: "forbidden" } });
        return;
      }
      if (path.endsWith("/restore")) active = true;
      await route.fulfill({
        json: {
          ok: true,
          value: {
            ok: true,
            value: {
              accountId: accountA,
              productId: accessProductId,
              access: "active",
              revision: 3,
              firstIssuedAt: null,
            },
          },
        },
      });
    });
    await page.goto(`${baseURL}?productAccess=1&secondary=1`);
    await browserExpect(
      productPanel(page, "Secondary access").getByText("Доступ отозван"),
    ).toBeVisible();
    await page.evaluate(() => {
      let announcements = 0;
      window.addEventListener("inside.enrollments.changed", () => {
        announcements += 1;
      });
      Object.defineProperty(window, "receivedAccessAnnouncements", {
        get: () => announcements,
      });
    });
    await productPanel(page, "Primary access")
      .getByRole("button", { name: "Восстановить доступ к «Test Product»" })
      .click();
    const restore = page.getByRole("dialog", {
      name: "Восстановить доступ к «Test Product»",
    });
    await restore.getByLabel("Причина").fill("owner reason");
    await restore.getByRole("button", { name: "Восстановить доступ" }).click();
    await browserExpect(restore.getByRole("alert")).toBeVisible();
    expect(
      await page.evaluate(
        () => Reflect.get(window, "receivedAccessAnnouncements") as unknown,
      ),
    ).toBe(0);
    deny = false;
    await restore.getByRole("button", { name: "Восстановить доступ" }).click();
    await browserExpect(
      productPanel(page, "Secondary access").getByText("Доступ открыт"),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => Reflect.get(window, "receivedAccessAnnouncements") as unknown,
      ),
    ).toBe(1);
  } finally {
    await context.close();
  }
}, 30_000);
