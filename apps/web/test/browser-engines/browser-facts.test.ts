import { fileURLToPath } from "node:url";
import {
  chromium,
  expect as browserExpect,
  type Browser,
  type Page,
} from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, test } from "vitest";

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
const operationRef = "00000000-0000-4000-8000-000000000010";
const material = {
  materialId,
  access: "free",
  availability: "available",
  cover: null,
  format: "Статья",
  formatSlug: "article",
  seriesMemberships: [],
  slug: "saved",
  summary: "Saved material",
  tags: [],
  title: "Saved for Account A",
  topic: "Архитектура",
  topicSlug: "architecture",
};
const ok = (result: unknown) => ({ ok: true, value: { operationRef, result } });

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
          state.saved =
            route
              .request()
              .postData()
              ?.includes('name="bookmarked"\r\n\r\ntrue') === true;
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
    await page.route("**/api/authoring/billing/**", (route) =>
      route.fulfill({
        json: ok({ outcome: "people", items: [], nextCursor: null }),
      }),
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

function accessFixture() {
  const state = { assigned: false, invitation: "absent" };
  const tier = {
    id: "00000000-0000-4000-8000-000000000101",
    revision: 3,
    name: "Assigned tariff",
    benefits: ["materials"],
    coverage: { productIds: [], materialIds: [] },
  };
  const issued = () => ({
    id: "00000000-0000-4000-8000-000000000020",
    code: "Synthetic",
    startParameter: "i_Synthetic",
    offerId: tier.id,
    offerRevision: 3,
    mode: "purchase",
    state: state.invitation,
    issuedAt: "2030-01-01T00:00:00.000Z",
    expiresAt: "2030-02-01T00:00:00.000Z",
    claimedAt: null,
    redeemedAt: null,
    revokedAt:
      state.invitation === "revoked" ? "2030-01-02T00:00:00.000Z" : null,
    accountId: null,
    revision: 1,
    link: null,
  });
  const attach = fixture(async (page) => {
    await page.route("**/api/authoring/billing/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let result: unknown;
      if (path.endsWith("/enrollments/assign")) {
        state.assigned = true;
        result = {
          outcome: "enrollment",
          value: {
            id: operationRef,
            accountId: accountA,
            tier,
            origin: "manual",
            startsAt: "2030-01-01T00:00:00.000Z",
            endsAt: null,
            endPolicy: "fixed",
            revision: 1,
            state: "active",
            renewal: "not_applicable",
          },
        };
      } else if (path.endsWith("/people/list")) {
        result = {
          outcome: "people",
          items: [
            {
              accountId: accountA,
              telegramIdentityRef: null,
              grounds: state.assigned
                ? [
                    {
                      kind: "enrollment",
                      id: operationRef,
                      revision: 1,
                      source: "manual",
                      offer: { id: tier.id, name: tier.name },
                      capabilities: ["materials"],
                      purchaseRef: null,
                      startsAt: "2030-01-01T00:00:00.000Z",
                      endsAt: null,
                      revokedAt: null,
                      endPolicy: "fixed",
                      state: "active",
                    },
                  ]
                : [],
            },
          ],
          nextCursor: null,
        };
      } else if (path.endsWith("/tiers/list")) {
        result = {
          outcome: "tiers",
          items: [
            {
              tier,
              availableForAssignment: true,
              published: false,
              archived: false,
            },
          ],
          nextCursor: null,
        };
      } else if (path.endsWith("/access-summary")) {
        result = {
          outcome: "accessSummary",
          value: {
            asOf: "2030-01-01T00:00:00.000Z",
            active: state.assigned
              ? [
                  {
                    offerId: tier.id,
                    name: tier.name,
                    paid: 0,
                    gift: 1,
                    course: 0,
                  },
                ]
              : [],
            invitations: {
              issued: state.invitation === "issued" ? 1 : 0,
              opened: 0,
              purchaseOpened: 0,
              paid: 0,
              expired: 0,
              revoked: state.invitation === "revoked" ? 1 : 0,
            },
            attention: [],
            revenue: [],
          },
        };
      } else {
        if (path.endsWith("/invitations/issue")) state.invitation = "issued";
        if (path.endsWith("/invitations/revoke")) state.invitation = "revoked";
        result = path.endsWith("/invitations/list")
          ? {
              outcome: "invitations",
              items: state.invitation === "absent" ? [] : [issued()],
              nextCursor: null,
            }
          : { outcome: "invitation", value: issued() };
      }
      await route.fulfill({ json: ok(result) });
    });
  }).attach;
  return { attach };
}

test("People and Summary observe an assignment from another open document", async () => {
  const context = await runningBrowser().newContext();
  try {
    const { attach } = accessFixture();
    const writer = await context.newPage();
    const reader = await context.newPage();
    await attach(writer);
    await attach(reader);
    const people = writer.getByRole("region", { name: "People", exact: true });
    await browserExpect(
      reader.getByText("Действующего доступа пока нет."),
    ).toBeVisible();
    await people.locator("summary").click();
    await people
      .getByLabel("Тариф для назначения")
      .selectOption({ label: "Assigned tariff" });
    await people.getByLabel("Причина назначения").fill("Contract test");
    await people.getByRole("button", { name: "Назначить без оплаты" }).click();
    await browserExpect(
      people.getByText("Тариф назначен. Платёж и списания не создавались."),
    ).toBeVisible();
    await browserExpect(
      reader
        .getByRole("region", { name: "People", exact: true })
        .locator("summary")
        .getByText("Assigned tariff", { exact: true }),
    ).toBeVisible();
    await browserExpect(
      reader
        .getByRole("region", { name: "Summary", exact: true })
        .getByText("Assigned tariff", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
}, 30_000);

for (const channel of ["BroadcastChannel", "window fallback"] as const) {
  test(`Invitations and Summary observe issue and revoke through ${channel}`, async () => {
    const context = await runningBrowser().newContext();
    try {
      if (channel === "window fallback")
        await context.addInitScript(() => {
          Reflect.deleteProperty(globalThis, "BroadcastChannel");
        });
      const { attach } = accessFixture();
      const writer = await context.newPage();
      await attach(writer, { secondary: channel === "window fallback" });
      const reader =
        channel === "window fallback" ? writer : await context.newPage();
      if (reader !== writer) await attach(reader);
      const summary = reader.getByRole("region", {
        name: channel === "window fallback" ? "Secondary Summary" : "Summary",
        exact: true,
      });
      const issuedCount = summary
        .locator("dl > div")
        .filter({ has: reader.getByText("Выдано", { exact: true }) })
        .locator("dd");
      const revokedCount = summary
        .locator("dl > div")
        .filter({ has: reader.getByText("Отозвано", { exact: true }) })
        .locator("dd");
      await browserExpect(issuedCount).toHaveText("0");
      const invitations = writer.getByRole("region", {
        name: "Invitations",
        exact: true,
      });
      await invitations
        .getByLabel("Предложение", { exact: true })
        .selectOption({ label: "Материалы" });
      await invitations
        .getByRole("button", { name: "Создать приглашение" })
        .click();
      await browserExpect(
        invitations.locator("[data-issued-invitation]"),
      ).toBeVisible();
      const readerInvitations = reader.getByRole("region", {
        name:
          channel === "window fallback"
            ? "Secondary Invitations"
            : "Invitations",
        exact: true,
      });
      await browserExpect(readerInvitations.getByRole("listitem")).toHaveCount(
        1,
      );
      await browserExpect(issuedCount).toHaveText("1");
      await invitations
        .getByRole("button", { name: "Отозвать", exact: true })
        .click();
      await browserExpect(
        invitations.getByText("Приглашение отозвано.", { exact: true }),
      ).toBeVisible();
      await browserExpect(
        readerInvitations
          .getByRole("listitem")
          .getByText("Отозвано", { exact: true }),
      ).toBeVisible();
      await browserExpect(revokedCount).toHaveText("1");
      await browserExpect(issuedCount).toHaveText("0");
    } finally {
      await context.close();
    }
  }, 30_000);
}

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
