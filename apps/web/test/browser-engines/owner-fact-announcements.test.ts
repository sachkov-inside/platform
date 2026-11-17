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
  { kind: "catalog", path: "**/api/authoring/billing/catalog" },
  { kind: "sale", path: "**/api/authoring/billing/product-sales-states" },
  { kind: "rules", path: "**/api/authoring/billing/activation-rules/list" },
  { kind: "promotions", path: "**/api/authoring/billing/promotions/list" },
] as const;
type Fact = (typeof facts)[number];
const firstProduct = "10000000-0000-4000-8000-000000000001";
const secondProduct = "10000000-0000-4000-8000-000000000002";
function ruleFixture(revision: number) {
  return {
    id: secondProduct,
    code: "SYNTHETIC",
    name: `Synthetic rules ${String(revision)}`,
    revision,
    productId: firstProduct,
    sourceRef: "synthetic-course",
    published: revision === 1,
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: null,
  };
}
function answer(kind: Fact["kind"], revision: number, empty = false) {
  const name = `Synthetic ${kind} ${String(revision)}`;
  if (kind === "rules")
    return {
      ok: true,
      value: {
        operationRef: secondProduct,
        result: { outcome: "activationRules", items: [ruleFixture(revision)] },
      },
    };
  if (kind === "promotions")
    return {
      ok: true,
      value: {
        operationRef: secondProduct,
        result: {
          outcome: "promotions",
          items: empty
            ? []
            : [
                {
                  id: secondProduct,
                  revision,
                  name,
                  percent: 10,
                  code: "SYNTHETIC",
                  startsAt: "2026-01-01T00:00:00.000Z",
                  endsAt: "2027-01-01T00:00:00.000Z",
                  productIds: [firstProduct],
                  usageLimit: null,
                  archived: false,
                  usedCount: 0,
                  questionnaire: false,
                  legacy: false,
                },
              ],
          nextCursor: null,
        },
      },
    };
  if (kind === "sale")
    return {
      ok: true,
      value: [
        {
          productId: firstProduct,
          revision,
          name: "Synthetic cohort",
          stage: "running",
          startsOn: "2026-11-16",
          nextEvent: "",
          priceAfterStartKopecks: null,
        },
      ],
    };
  return {
    ok: true,
    value: {
      items: [],
      archivedProductIds:
        revision === 1 ? [firstProduct] : [firstProduct, secondProduct],
    },
  };
}
let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let baseURL = "";
function runningBrowser() {
  if (browser === undefined)
    throw new Error("Owner fact browser is not running");
  return browser;
}
beforeAll(async () => {
  server = await createServer({
    configFile: false,
    define: { "process.env": "{}" },
    root: fileURLToPath(new URL("../../", import.meta.url)),
    cacheDir: "node_modules/.cache/owner-fact-announcements",
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("../../src", import.meta.url)),
        "next/navigation": fileURLToPath(
          new URL("../../file-preview/next-navigation.ts", import.meta.url),
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
      throw new Error("Missing owner fact listener");
    baseURL = `http://127.0.0.1:${String(address.port)}/test/support/owner-fact-announcements.html`;
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
  fact: Fact,
  revision: number,
  independent = false,
) {
  for (const label of independent
    ? ["Independent cache"]
    : ["Primary", "Same cache"]) {
    const surface = page.getByLabel(label, { exact: true });
    if (fact.kind === "rules" || fact.kind === "promotions")
      await browserExpect(
        (fact.kind === "promotions"
          ? surface.getByRole("table")
          : surface
        ).getByText(`Synthetic ${fact.kind} ${String(revision)}`, {
          exact: true,
        }),
      ).toBeVisible();
    else await browserExpect(surface).toHaveText(String(revision));
  }
}

for (const fact of facts) {
  test(`${fact.kind}: fallback shares each announced read with sibling observers and independent caches`, async () => {
    const context = await runningBrowser().newContext();
    let revision = 1;
    let reads = 0;
    try {
      await context.addInitScript(() => {
        Object.defineProperty(window, "BroadcastChannel", { value: undefined });
      });
      const page = await context.newPage();
      if (fact.kind !== "catalog")
        await page.route("**/api/authoring/billing/catalog", (route) =>
          route.fulfill({ json: answer("catalog", 1) }),
        );
      await page.route(fact.path, (route) => {
        reads++;
        return route.fulfill({ json: answer(fact.kind, revision) });
      });
      await page.goto(`${baseURL}?kind=${fact.kind}&secondary=1`);
      await state(page, fact, 1);
      await state(page, fact, 1, true);
      expect(reads).toBe(2);
      revision = 2;
      await page.getByRole("button", { name: "Announce write" }).click();
      await state(page, fact, 2);
      await state(page, fact, 2, true);
      expect(reads).toBe(4);
    } finally {
      await context.close();
    }
  }, 30_000);

  test(`${fact.kind}: an announced write supersedes the pending pre-write read in another document`, async () => {
    const context = await runningBrowser().newContext();
    const held = Promise.withResolvers<undefined>();
    const reading = Promise.withResolvers<undefined>();
    const delivered = Promise.withResolvers<undefined>();
    let reads = 0;
    try {
      const writer = await context.newPage();
      if (fact.kind !== "catalog")
        await context.route("**/api/authoring/billing/catalog", (route) =>
          route.fulfill({ json: answer("catalog", 1) }),
        );
      await writer.route(fact.path, (route) =>
        route.fulfill({ json: answer(fact.kind, 1) }),
      );
      await writer.goto(`${baseURL}?kind=${fact.kind}`);
      await state(writer, fact, 1);
      const reader = await context.newPage();
      await reader.route(fact.path, async (route) => {
        const current = ++reads;
        if (current === 1) {
          reading.resolve(undefined);
          await held.promise;
        }
        try {
          await route.fulfill({
            json: answer(fact.kind, current === 1 ? 1 : 2),
          });
        } finally {
          if (current === 1) delivered.resolve(undefined);
        }
      });
      await reader.goto(`${baseURL}?kind=${fact.kind}`);
      await reading.promise;
      await writer.getByRole("button", { name: "Announce write" }).click();
      await state(reader, fact, 2);
      expect(reads).toBe(2);
      held.resolve(undefined);
      await delivered.promise;
      await state(reader, fact, 2);
      expect(reads).toBe(2);
    } finally {
      held.resolve(undefined);
      await context.close();
    }
  }, 30_000);
}

test("rules: a successful writer shares its immediate refresh with every local observer", async () => {
  const context = await runningBrowser().newContext();
  const held = Promise.withResolvers<undefined>();
  let revision = 1;
  let reads = 0;
  const fact = facts.find((item) => item.kind === "rules");
  if (fact === undefined) throw new Error("Missing activation rule fact");
  try {
    await context.addInitScript(() => {
      Object.defineProperty(window, "BroadcastChannel", { value: undefined });
    });
    const page = await context.newPage();
    await page.route(fact.path, async (route) => {
      reads++;
      if (reads === 3) await held.promise;
      await route.fulfill({ json: answer("rules", revision) });
    });
    await page.route(
      "**/api/authoring/billing/activation-rules/save",
      async (route) => {
        expect(route.request().postDataJSON()).toMatchObject({
          expectedRevision: 1,
          value: { id: secondProduct, published: false },
        });
        revision = 2;
        await route.fulfill({
          json: {
            ok: true,
            value: {
              operationRef: secondProduct,
              result: { outcome: "activationRule", value: ruleFixture(2) },
            },
          },
        });
      },
    );
    await page.goto(`${baseURL}?kind=rules&secondary=1`);
    await state(page, fact, 1);
    await state(page, fact, 1, true);
    expect(reads).toBe(2);
    await page
      .getByLabel("Primary", { exact: true })
      .getByRole("button", {
        name: "Приостановить «Synthetic rules 1»",
        exact: true,
      })
      .click();
    await state(page, fact, 2, true);
    held.resolve(undefined);
    await state(page, fact, 2);
    expect(reads).toBe(4);
    await browserExpect(
      page
        .getByLabel("Primary", { exact: true })
        .getByText("Правило приостановлено.", { exact: true }),
    ).toBeVisible();
  } finally {
    held.resolve(undefined);
    await context.close();
  }
}, 30_000);

test("promotions: an archive shares its immediate refresh with every local observer", async () => {
  const context = await runningBrowser().newContext();
  const held = Promise.withResolvers<undefined>();
  let archived = false;
  let reads = 0;
  const fact = facts.find((item) => item.kind === "promotions");
  if (fact === undefined) throw new Error("Missing promotions fact");
  try {
    await context.addInitScript(() => {
      Object.defineProperty(window, "BroadcastChannel", { value: undefined });
    });
    const page = await context.newPage();
    await page.route("**/api/authoring/billing/catalog", (route) =>
      route.fulfill({ json: answer("catalog", 1) }),
    );
    await page.route(fact.path, async (route) => {
      reads++;
      if (reads === 3) await held.promise;
      await route.fulfill({ json: answer("promotions", 1, archived) });
    });
    await page.route(
      "**/api/authoring/billing/promotions/archive",
      async (route) => {
        expect(route.request().postDataJSON()).toMatchObject({
          expectedRevision: 1,
          id: secondProduct,
        });
        archived = true;
        await route.fulfill({
          json: {
            ok: true,
            value: {
              operationRef: secondProduct,
              result: {
                outcome: "catalog",
                value: { id: secondProduct, revision: 2, archived: true },
              },
            },
          },
        });
      },
    );
    await page.goto(`${baseURL}?kind=promotions&secondary=1`);
    await state(page, fact, 1);
    await state(page, fact, 1, true);
    expect(reads).toBe(2);
    await page
      .getByLabel("Primary", { exact: true })
      .getByRole("table")
      .getByRole("button", {
        name: "Действия со скидкой «Synthetic promotions 1»",
        exact: true,
      })
      .click();
    await page
      .getByRole("menuitem", { name: "Архивировать", exact: true })
      .click();
    await page
      .getByRole("dialog", {
        name: "Архивировать «Synthetic promotions 1»?",
        exact: true,
      })
      .getByRole("button", { name: "Архивировать скидку", exact: true })
      .click();
    await browserExpect(
      page
        .getByLabel("Independent cache", { exact: true })
        .getByText("Скидок пока нет", { exact: true }),
    ).toBeVisible();
    held.resolve(undefined);
    for (const label of ["Primary", "Same cache"])
      await browserExpect(
        page
          .getByLabel(label, { exact: true })
          .getByText("Скидок пока нет", { exact: true }),
      ).toBeVisible();
    expect(reads).toBe(4);
  } finally {
    held.resolve(undefined);
    await context.close();
  }
}, 30_000);
