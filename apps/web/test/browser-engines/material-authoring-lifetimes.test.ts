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

test("chromium: text and caret stay below the editor toolbar in a short window (#2233)", async () => {
  const browser = browsers.get("chromium");
  if (browser === undefined) throw new Error("Missing chromium");
  const page = await browser.newPage({
    viewport: { width: 1280, height: 577 },
  });
  try {
    await page.goto(url);
    // Supply the viewport-sized scrollport that the authoring route provides.
    await page.addStyleTag({
      content: `
        #root > :not([data-material-authoring]) { display: none; }
        #root > [data-material-authoring] { height: 100dvh; }
      `,
    });
    const editor = page.getByRole("textbox", { name: "Содержимое материала" });
    await browserExpect(editor).toBeVisible();
    await editor.press("End");
    for (let index = 0; index < 12; index += 1) {
      await editor.press("Enter");
      await page.keyboard.insertText("Строка для прокрутки");
    }

    await editor.evaluate((node) => {
      node.scrollIntoView({ block: "start" });
    });
    const readPosition = () =>
      editor.evaluate((node) => {
        const toolbar = document.querySelector(
          "[data-material-editor-toolbar]",
        );
        const line = node.firstElementChild;
        if (toolbar === null || line === null)
          throw new Error("Editor toolbar or first line is missing");
        const toolbarBottom = toolbar.getBoundingClientRect().bottom;
        const lineTop = line.getBoundingClientRect().top;
        const selection = window.getSelection();
        const caret =
          selection !== null &&
          selection.isCollapsed &&
          selection.anchorNode === line.firstChild &&
          selection.anchorOffset === 2
            ? selection.getRangeAt(0).getBoundingClientRect()
            : null;
        return {
          lineAboveToolbarBottom: lineTop < toolbarBottom,
          caretVisible:
            caret !== null &&
            caret.top >= toolbarBottom &&
            caret.bottom <= window.innerHeight,
        };
      });
    await browserExpect.poll(readPosition).toMatchObject({
      lineAboveToolbarBottom: false,
    });

    await editor.evaluate((node) => {
      const scroller = node.closest("[data-material-authoring]");
      const toolbar = scroller?.querySelector("[data-material-editor-toolbar]");
      const line = node.firstElementChild;
      const selection = window.getSelection();
      const text = line?.firstChild;
      if (
        scroller === null ||
        !toolbar ||
        !line ||
        selection === null ||
        text?.nodeType !== Node.TEXT_NODE
      )
        throw new Error("Cannot place the caret on the first line");
      const overlapPx = 24;
      node.focus({ preventScroll: true });
      selection.collapse(text, 1);
      scroller.scrollTop +=
        line.getBoundingClientRect().top -
        toolbar.getBoundingClientRect().bottom +
        overlapPx;
    });
    await browserExpect.poll(readPosition).toMatchObject({
      lineAboveToolbarBottom: true,
    });
    await page.keyboard.press("ArrowRight");
    await browserExpect.poll(readPosition).toMatchObject({
      caretVisible: true,
    });
  } finally {
    await page.close();
  }
}, 15_000);

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
  test(`${engine}: physical editor removal rejects late URL acquisition before React disposal`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error(`Missing ${engine}`);
    const context = await browser.newContext();
    const release = Promise.withResolvers<undefined>();
    try {
      const page = await context.newPage();
      const requested = Promise.withResolvers<undefined>();
      let requests = 0;
      await page.route("**/api/authoring/materials/*/assets", async (route) => {
        requests += 1;
        if (requests === 2) {
          requested.resolve(undefined);
          await release.promise;
        }
        await route.fulfill({
          status: 201,
          json: {
            assetId:
              requests === 1
                ? "03000000-0000-4000-8000-000000000001"
                : "03000000-0000-4000-8000-000000000002",
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
      await page.evaluate(() => {
        const proof = document.createElement("output");
        proof.id = "physical-removal-proof";
        proof.dataset["created"] = "0";
        proof.dataset["terminal"] = "0";
        document.body.append(proof);
        const create = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (...args) => {
          proof.dataset["created"] = String(
            Number(proof.dataset["created"]) + 1,
          );
          return create(...args);
        };
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Native observer forwards original receiver.
        const send = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (body) {
          this.addEventListener(
            "loadend",
            () => {
              proof.dataset["terminal"] = String(
                Number(proof.dataset["terminal"]) + 1,
              );
            },
            { once: true },
          );
          send.call(this, body);
        };
      });
      await selectImage(page);
      const image = page.locator('#material-body img[src^="blob:"]');
      await browserExpect(image).toHaveCount(1);
      const src = await image.getAttribute("src");
      await selectImage(page);
      await requested.promise;
      // Native containment ends first. React has not been asked to dispose its root yet.
      await page.locator("#root").evaluate((node) => {
        node.remove();
      });
      await browserExpect
        .poll(() =>
          page.evaluate(async (url) => {
            try {
              return (await fetch(url ?? "")).ok;
            } catch {
              return false;
            }
          }, src),
        )
        .toBe(false);
      release.resolve(undefined);
      await browserExpect(
        page.locator("#physical-removal-proof"),
      ).toHaveAttribute("data-terminal", "2");
      await browserExpect(
        page.locator("#physical-removal-proof"),
      ).toHaveAttribute("data-created", "1");
    } finally {
      release.resolve(undefined);
      await context.close();
    }
  }, 15_000);

  test(`${engine}: a late response cannot insert into another Material`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error(`Missing ${engine}`);
    const context = await browser.newContext();
    const release = Promise.withResolvers<undefined>();
    try {
      const page = await context.newPage();
      const requested = Promise.withResolvers<undefined>();
      const replied = Promise.withResolvers<undefined>();
      let aborted = false;
      page.on("requestfailed", (request) => {
        if (request.url().endsWith("/assets")) aborted = true;
      });
      await page.route("**/api/authoring/materials/*/assets", async (route) => {
        requested.resolve(undefined);
        await release.promise;
        try {
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
        } finally {
          replied.resolve(undefined);
        }
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
      await browserExpect.poll(() => aborted).toBe(true);
      release.resolve(undefined);
      await replied.promise;
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
      await browserExpect
        .poll(() =>
          page.evaluate(() => window.getSelection()?.toString().trim()),
        )
        .toBe("Before upload");
      await page.keyboard.type("Ahead while loading");
      await browserExpect(editor.locator(":scope > p")).toHaveText([
        "Ahead while loading",
      ]);
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
