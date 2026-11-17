import {
  expect as browserExpect,
  type Browser,
  type Page,
} from "@playwright/test";
import { afterAll, beforeAll, test } from "vitest";
import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";

const fixture = createOwnedBrowserFixture("material-authoring");
let browsers: ReadonlyMap<string, Browser> = new Map();
let url = "";
beforeAll(async () => {
  const started = await fixture.start();
  browsers = started.browsers;
  url = started.url;
}, 30_000);
afterAll(() => fixture.close(), 30_000);

async function selectImage(page: Page) {
  await page
    .getByRole("button", { name: "Добавить блок", exact: true })
    .click();
  await page.getByLabel("Выбрать изображения").setInputFiles({
    name: "proof.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
    ),
  });
}
for (const engine of ["chromium", "webkit"] as const) {
  test(`${engine}: a late response cannot insert into another Material`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error(`Missing ${engine}`);
    const context = await browser.newContext();
    const release = Promise.withResolvers<undefined>();
    try {
      const page = await context.newPage();
      const requested = Promise.withResolvers<undefined>();
      await page.route("**/api/authoring/materials/*/assets", async (route) => {
        requested.resolve(undefined);
        await release.promise;
        await route.fulfill({
          status: 201,
          json: {
            assetId: "03000000-0000-4000-8000-000000000001",
            contentType: "image/svg+xml",
            filename: "proof.svg",
            kind: "image",
            size: 120,
            state: "ready",
          },
        });
      });
      await page.goto(url);
      const editor = page.getByRole("textbox", {
        name: "Содержимое материала",
      });
      await browserExpect(editor).toBeVisible();
      await selectImage(page);
      await requested.promise;
      await page.getByRole("button", { name: "Switch Material" }).click();
      await browserExpect(
        page.getByRole("button", { name: "Отменить загрузку" }),
      ).toHaveCount(0);
      release.resolve(undefined);
      await browserExpect(editor.locator('img[src^="blob:"]')).toHaveCount(0);
      await page.getByRole("button", { name: "Toggle readonly" }).click();
      await browserExpect(editor).toHaveAttribute("contenteditable", "false");
      await page.getByRole("button", { name: "Toggle readonly" }).click();
      await browserExpect(editor).toHaveAttribute("contenteditable", "true");
    } finally {
      release.resolve(undefined);
      await context.close();
    }
  }, 15_000);

  test(`${engine}: removal during native hashing never acquires a late upload request`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error(`Missing ${engine}`);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(url);
      await browserExpect(
        page.getByRole("textbox", { name: "Содержимое материала" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Добавить блок", exact: true })
        .click();
      await page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>(
          'input[aria-label="Выбрать изображения"]',
        );
        const remove = [...document.querySelectorAll("button")].find(
          (node) => node.textContent === "Toggle mount",
        );
        if (input === null || remove === undefined)
          throw new Error("Missing upload controls");
        // Transparent observations forward native hashing and native XHR acquisition unchanged.
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Native spy forwards the original receiver.
        const open = XMLHttpRequest.prototype.open;
        const proof = document.createElement("output");
        proof.id = "native-hashing-proof";
        proof.dataset["opens"] = "0";
        document.body.append(proof);
        crypto.subtle.digest = async (...args) => {
          const result = await digest(...args);
          proof.dataset["settled"] = "true";
          return result;
        };
        XMLHttpRequest.prototype.open = function (
          method,
          url,
          async?: boolean,
          username?: string | null,
          password?: string | null,
        ) {
          proof.dataset["opens"] = String(Number(proof.dataset["opens"]) + 1);
          open.call(this, method, url, async ?? true, username, password);
        };
        const files = new DataTransfer();
        files.items.add(
          new File([new Uint8Array(1024)], "late.png", { type: "image/png" }),
        );
        input.files = files.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        remove.click();
      });
      await browserExpect(page.locator("#material-body")).toHaveCount(0);
      await browserExpect(
        page.locator("#native-hashing-proof"),
      ).toHaveAttribute("data-settled", "true");
      await browserExpect(
        page.locator("#native-hashing-proof"),
      ).toHaveAttribute("data-opens", "0");
    } finally {
      await context.close();
    }
  }, 15_000);

  test(`${engine}: pending upload follows document transactions and native cancel aborts its request`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error(`Missing ${engine}`);
    const context = await browser.newContext();
    const release = Promise.withResolvers<undefined>();
    try {
      const page = await context.newPage();
      const requested = Promise.withResolvers<undefined>();
      await page.route("**/api/authoring/materials/*/assets", async (route) => {
        requested.resolve(undefined);
        await release.promise;
        await route.fulfill({
          status: 201,
          json: {
            assetId: "03000000-0000-4000-8000-000000000001",
            contentType: "image/svg+xml",
            filename: "proof.svg",
            kind: "image",
            size: 120,
            state: "ready",
          },
        });
      });
      await page.goto(url);
      const editor = page.getByRole("textbox", {
        name: "Содержимое материала",
      });
      await browserExpect(editor).toBeVisible();
      await selectImage(page);
      await requested.promise;
      await editor.click();
      await editor.press("ControlOrMeta+a");
      await editor.press("ArrowRight");
      await editor.press("Enter");
      await editor.pressSequentially("Ahead while loading");
      release.resolve(undefined);
      await browserExpect(editor.locator('img[src^="blob:"]')).toHaveCount(1);
      await browserExpect(
        editor
          .locator(".react-renderer")
          .first()
          .locator("xpath=preceding-sibling::*[1]"),
      ).toHaveText("Ahead while loading");
      // A second real request is cancelled while its HTTP response is pending.
      const second = Promise.withResolvers<undefined>();
      await page.route("**/api/authoring/materials/*/assets", async (route) => {
        second.resolve(undefined);
        await route.request().response();
      });
      let aborted = false;
      page.on("requestfailed", (request) => {
        if (request.url().endsWith("/assets")) aborted = true;
      });
      await selectImage(page);
      await second.promise;
      await page.getByRole("button", { name: "Отменить загрузку" }).click();
      await browserExpect.poll(() => aborted).toBe(true);
      await browserExpect(
        page.getByRole("button", { name: "Отменить загрузку" }),
      ).toHaveCount(0);
      await browserExpect(editor.locator('img[src^="blob:"]')).toHaveCount(1);
    } finally {
      release.resolve(undefined);
      await context.close();
    }
  }, 15_000);

  test(`${engine}: a terminal upload failure releases unload protection and retry inserts once`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error(`Missing ${engine}`);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      let calls = 0;
      await page.route("**/api/authoring/materials/*/assets", (route) => {
        calls += 1;
        return calls === 1
          ? route.fulfill({
              status: 503,
              json: { code: "dependency_unavailable" },
            })
          : route.fulfill({
              status: 201,
              json: {
                assetId: "03000000-0000-4000-8000-000000000001",
                contentType: "image/svg+xml",
                filename: "proof.svg",
                kind: "image",
                size: 120,
                state: "ready",
              },
            });
      });
      await page.goto(url);
      await browserExpect(
        page.getByRole("textbox", { name: "Содержимое материала" }),
      ).toBeVisible();
      await selectImage(page);
      await browserExpect(
        page.getByRole("button", { name: "Повторить загрузку" }),
      ).toBeVisible();
      await browserExpect
        .poll(() =>
          page.evaluate(() => {
            const event = new Event("beforeunload", { cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
          }),
        )
        .toBe(false);
      await page.getByRole("button", { name: "Toggle visibility" }).click();
      await browserExpect(
        page.getByRole("textbox", { name: "Содержимое материала" }),
      ).not.toBeVisible();
      await page.getByRole("button", { name: "Toggle visibility" }).click();
      await browserExpect(
        page.getByRole("button", { name: "Повторить загрузку" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Повторить загрузку" }).click();
      await browserExpect(
        page.locator('#material-body img[src^="blob:"]'),
      ).toHaveCount(1);
      await browserExpect(
        page.getByRole("button", { name: "Отменить загрузку" }),
      ).toHaveCount(0);
      browserExpect(calls).toBe(2);
    } finally {
      await context.close();
    }
  }, 15_000);

  test(`${engine}: uploaded image and text remain usable after retained hide`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error(`Missing ${engine}`);
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(3_000);
      const errors: string[] = [];
      page.on("pageerror", (error) =>
        errors.push(error.stack ?? error.message),
      );
      await page.route("**/api/authoring/materials/*/assets", (route) =>
        route.fulfill({
          status: 201,
          json: {
            assetId: "03000000-0000-4000-8000-000000000001",
            contentType: "image/svg+xml",
            filename: "proof.svg",
            kind: "image",
            size: 120,
            state: "ready",
          },
        }),
      );
      await page.goto(url);
      await browserExpect(page.getByRole("button", { name: "Toggle mount" }))
        .toBeVisible()
        .catch((error: unknown) => {
          throw new Error(JSON.stringify(errors), { cause: error });
        });
      browserExpect(errors).toEqual([]);
      const editor = page.getByRole("textbox", {
        name: "Содержимое материала",
      });
      await browserExpect(editor).toBeVisible();
      await editor.press("End");
      await editor.pressSequentially(" retained text");
      await selectImage(page);
      const image = editor.locator('img[src^="blob:"]');
      await browserExpect(image).toHaveCount(1);
      await browserExpect
        .poll(() =>
          image.evaluate((node: HTMLImageElement) => node.naturalWidth),
        )
        .toBe(10);
      const blobUrl = await image.getAttribute("src");
      await page.getByRole("button", { name: "Toggle visibility" }).click();
      await browserExpect(editor).not.toBeVisible();
      // A completed fetch of the original blob proves the retained preview is still live.
      browserExpect(
        await page.evaluate(async (src) => {
          try {
            return (await fetch(src ?? "")).ok;
          } catch {
            return false;
          }
        }, blobUrl),
      ).toBe(true);
      await page.getByRole("button", { name: "Toggle visibility" }).click();
      await browserExpect(editor)
        .toContainText("retained text")
        .catch(async (error: unknown) => {
          throw new Error(
            JSON.stringify({
              errors,
              body: await page.locator("body").innerText(),
            }),
            { cause: error },
          );
        });
      await browserExpect(image).toHaveCount(1);
      await browserExpect
        .poll(() =>
          image.evaluate((node: HTMLImageElement) => node.naturalWidth),
        )
        .toBe(10);
      await page.getByRole("button", { name: "Toggle mount" }).click();
      await browserExpect(editor).toHaveCount(0);
      await browserExpect
        .poll(() =>
          page.evaluate(async (src) => {
            try {
              return (await fetch(src ?? "")).ok;
            } catch {
              return false;
            }
          }, blobUrl),
        )
        .toBe(false);
    } finally {
      await context.close();
    }
  }, 15_000);
}
