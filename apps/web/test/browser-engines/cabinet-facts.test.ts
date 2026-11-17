import { expect as browserExpect, type Page } from "@playwright/test";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createOwnedBrowserFixture,
  type BrowserFixture,
} from "../support/owned-browser-fixture";

const fixture = createOwnedBrowserFixture("cabinet-facts");
let running: BrowserFixture;
beforeAll(async () => {
  running = await fixture.start();
}, 30_000);
afterAll(async () => {
  await fixture.close();
}, 10_000);
function billing(name: string) {
  return {
    ok: true,
    value: {
      products: [
        {
          id: "60000000-0000-4000-8000-000000000001",
          slug: "synthetic",
          name,
          materials: { state: "available" },
          community: { state: "available" },
        },
      ],
      access: { grounds: [] },
      notices: [],
      payments: [],
    },
  };
}
async function state(page: Page, value: string) {
  for (const label of ["Primary", "Same cache"])
    await browserExpect(page.getByLabel(label, { exact: true })).toHaveText(
      value,
    );
}
for (const engine of ["chromium", "webkit"]) {
  test(`${engine}: billing observers share the initial buyer state`, async () => {
    const browser = running.browsers.get(engine);
    if (browser === undefined) throw new Error("Missing owned engine");
    const context = await browser.newContext();
    let reads = 0;
    try {
      const page = await context.newPage();
      await page.route("**/api/account/billing", (route) => {
        reads++;
        return route.fulfill({ json: billing("Old product") });
      });
      await page.goto(running.url);
      await state(page, "Old product");
      expect(reads).toBe(1);
    } finally {
      await context.close();
    }
  });
  test(`${engine}: billing reads after an announced write while the pre-write read is held`, async () => {
    const browser = running.browsers.get(engine);
    if (browser === undefined) throw new Error("Missing owned engine");
    const context = await browser.newContext();
    const held = Promise.withResolvers<undefined>();
    const started = Promise.withResolvers<undefined>();
    const delivered = Promise.withResolvers<undefined>();
    let reads = 0;
    try {
      const writer = await context.newPage();
      await writer.route("**/api/account/billing", (route) =>
        route.fulfill({ json: billing("Old product") }),
      );
      await writer.goto(running.url);
      await state(writer, "Old product");
      const reader = await context.newPage();
      await reader.route("**/api/account/billing", async (route) => {
        const current = ++reads;
        if (current === 1) {
          started.resolve(undefined);
          await held.promise;
        }
        try {
          await route.fulfill({
            json: billing(current === 1 ? "Old product" : "Fresh product"),
          });
        } finally {
          if (current === 1) delivered.resolve(undefined);
        }
      });
      await reader.goto(running.url);
      await started.promise;
      await writer.getByRole("button", { name: "Announce write" }).click();
      await state(reader, "Fresh product");
      expect(reads).toBe(2);
      held.resolve(undefined);
      await delivered.promise;
      await state(reader, "Fresh product");
      expect(reads).toBe(2);
    } finally {
      held.resolve(undefined);
      await context.close();
    }
  }, 30_000);

  for (const source of ["billing", "enrollment"]) {
    test(`${engine}: ${source} fallback shares a fresh buyer read per cache`, async () => {
      const browser = running.browsers.get(engine);
      if (browser === undefined) throw new Error("Missing owned engine");
      const context = await browser.newContext();
      let name = "Old product";
      let reads = 0;
      try {
        await context.addInitScript(() => {
          Object.defineProperty(window, "BroadcastChannel", {
            value: undefined,
          });
        });
        const page = await context.newPage();
        await page.route("**/api/account/billing", (route) => {
          reads++;
          return route.fulfill({ json: billing(name) });
        });
        await page.goto(
          `${running.url}?secondary=1${source === "enrollment" ? "&enrollment=1" : ""}`,
        );
        await state(page, "Old product");
        await browserExpect(
          page.getByLabel("Independent cache", { exact: true }),
        ).toHaveText("Old product");
        expect(reads).toBe(2);
        name = "Fresh product";
        await page.getByRole("button", { name: "Announce write" }).click();
        await state(page, "Fresh product");
        await browserExpect(
          page.getByLabel("Independent cache", { exact: true }),
        ).toHaveText("Fresh product");
        expect(reads).toBe(4);
      } finally {
        await context.close();
      }
    });
  }

  test(`${engine}: community observers share the server's product step`, async () => {
    const browser = running.browsers.get(engine);
    if (browser === undefined) throw new Error("Missing owned engine");
    const context = await browser.newContext();
    let reads = 0;
    try {
      const page = await context.newPage();
      await page.route("**/api/account/community-entry?*", (route) => {
        reads++;
        return route.fulfill({
          json: { ok: true, value: { kind: "restricted" } },
        });
      });
      await page.goto(`${running.url}?kind=community`);
      await state(page, "restricted");
      expect(reads).toBe(1);
    } finally {
      await context.close();
    }
  });
  test(`${engine}: community reads after an announced write while the pre-write read is held`, async () => {
    const browser = running.browsers.get(engine);
    if (browser === undefined) throw new Error("Missing owned engine");
    const context = await browser.newContext();
    const held = Promise.withResolvers<undefined>();
    const started = Promise.withResolvers<undefined>();
    const delivered = Promise.withResolvers<undefined>();
    let reads = 0;
    try {
      const writer = await context.newPage();
      await writer.route("**/api/account/community-entry?*", (route) =>
        route.fulfill({ json: { ok: true, value: { kind: "restricted" } } }),
      );
      await writer.goto(`${running.url}?kind=community`);
      await state(writer, "restricted");
      const reader = await context.newPage();
      await reader.route("**/api/account/community-entry?*", async (route) => {
        const current = ++reads;
        if (current === 1) {
          started.resolve(undefined);
          await held.promise;
        }
        try {
          await route.fulfill({
            json: {
              ok: true,
              value: { kind: current === 1 ? "restricted" : "member" },
            },
          });
        } finally {
          if (current === 1) delivered.resolve(undefined);
        }
      });
      await reader.goto(`${running.url}?kind=community`);
      await started.promise;
      await writer.getByRole("button", { name: "Announce write" }).click();
      await state(reader, "member");
      expect(reads).toBe(2);
      held.resolve(undefined);
      await delivered.promise;
      await state(reader, "member");
      expect(reads).toBe(2);
    } finally {
      held.resolve(undefined);
      await context.close();
    }
  }, 30_000);

  test(`${engine}: community fallback refreshes every Product and shares each cache read`, async () => {
    const browser = running.browsers.get(engine);
    if (browser === undefined) throw new Error("Missing owned engine");
    const context = await browser.newContext();
    let kind = "restricted";
    let reads = 0;
    try {
      await context.addInitScript(() => {
        Object.defineProperty(window, "BroadcastChannel", { value: undefined });
      });
      const page = await context.newPage();
      await page.route("**/api/account/community-entry?*", (route) => {
        reads++;
        return route.fulfill({ json: { ok: true, value: { kind } } });
      });
      await page.goto(`${running.url}?kind=community&secondary=1&other=1`);
      await state(page, "restricted");
      await browserExpect(
        page.getByLabel("Independent cache", { exact: true }),
      ).toHaveText("restricted");
      await browserExpect(
        page.getByLabel("Other Product", { exact: true }),
      ).toHaveText("restricted");
      expect(reads).toBe(3);
      kind = "member";
      await page.getByRole("button", { name: "Announce write" }).click();
      await state(page, "member");
      await browserExpect(
        page.getByLabel("Independent cache", { exact: true }),
      ).toHaveText("member");
      await browserExpect(
        page.getByLabel("Other Product", { exact: true }),
      ).toHaveText("member");
      expect(reads).toBe(6);
    } finally {
      await context.close();
    }
  });
  for (const kind of ["billing", "community"]) {
    test(`${engine}: disabled ${kind} observers stay idle after an announcement`, async () => {
      const browser = running.browsers.get(engine);
      if (browser === undefined) throw new Error("Missing owned engine");
      const context = await browser.newContext();
      let reads = 0;
      try {
        await context.addInitScript(() => {
          Object.defineProperty(window, "BroadcastChannel", {
            value: undefined,
          });
        });
        const page = await context.newPage();
        await page.route(
          kind === "billing"
            ? "**/api/account/billing"
            : "**/api/account/community-entry?*",
          (route) => {
            reads++;
            return route.fulfill({
              json:
                kind === "billing"
                  ? billing("Fresh product")
                  : { ok: true, value: { kind: "member" } },
            });
          },
        );
        await page.goto(`${running.url}?kind=${kind}&disabled=1`);
        await state(page, "Loading");
        await browserExpect(
          page.getByLabel("Primary", { exact: true }).locator("span"),
        ).toHaveAttribute("data-fetch-status", "idle");
        await page.getByRole("button", { name: "Announce write" }).click();
        await state(page, "Loading");
        await browserExpect(
          page.getByLabel("Primary", { exact: true }).locator("span"),
        ).toHaveAttribute("data-fetch-status", "idle");
        expect(reads).toBe(0);
      } finally {
        await context.close();
      }
    });
  }
}
