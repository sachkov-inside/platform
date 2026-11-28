import { rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect as ui,
  type Browser,
  type Page,
  type Route,
} from "@playwright/test";
import { afterAll, beforeAll, test } from "vitest";
import { z } from "zod";

import { prepareEvidenceDirectory } from "../../../../scripts/evidence-path.mjs";

import { parsePrivateProfile } from "@/entities/account-profile";
import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";

const fixture = createOwnedBrowserFixture("account-avatar");
const avatarFile = fileURLToPath(
  new URL("../support/fixtures/account-avatar.png", import.meta.url),
);
const receiptsSchema = z.array(
  z.object({
    url: z.string(),
    fileName: z.string().nullable(),
    released: z.boolean(),
  }),
);
const uploadResponse = {
  profile: {
    avatar: { avatarId: "00000000-0000-4000-8000-000000000239" },
    bio: null,
    createdAt: "2026-11-16T12:00:00.000Z",
    displayName: "Проверка аватара",
    status: "active",
    updatedAt: "2026-11-16T12:00:00.000Z",
    version: 2,
  },
} as const;
parsePrivateProfile(uploadResponse);
let browsers: ReadonlyMap<string, Browser> = new Map();
let url = "";
beforeAll(async () => {
  const started = await fixture.start();
  browsers = started.browsers;
  url = started.url;
}, 30_000);
afterAll(() => fixture.close(), 30_000);

async function receipts(page: Page) {
  const text = await page.getByLabel("URL receipts").textContent();
  return receiptsSchema.parse(JSON.parse(text ?? "null"));
}

async function inspect(page: Page) {
  await page.locator("#inspect").evaluate((button: HTMLButtonElement) => {
    button.click();
  });
  return receipts(page);
}

async function captureState(page: Page, engine: string, state: string) {
  if (process.env["CAPTURE_AVATAR_EVIDENCE"] !== "1") return;
  const directory = await prepareEvidenceDirectory("issue-2393", {
    NODE_ENV: "test",
  });
  await page.screenshot({
    path: `${directory}/${engine}-${state}.png`,
    fullPage: true,
  });
  const browserState = await page.evaluate(() => {
    const dialog = document.querySelector("dialog");
    const image = dialog?.querySelector("img");
    return {
      url: location.href,
      dialog:
        dialog instanceof HTMLDialogElement
          ? {
              connected: dialog.isConnected,
              open: dialog.open,
              modal: dialog.matches(":modal"),
            }
          : null,
      preview:
        image instanceof HTMLImageElement
          ? { complete: image.complete, width: image.naturalWidth }
          : null,
    };
  });
  await writeFile(
    `${directory}/${engine}-${state}.json`,
    JSON.stringify(
      { ...browserState, resources: await receipts(page) },
      null,
      2,
    ) + "\n",
  );
}

type RunAvatarOperation = <T>(
  name: string,
  operation: () => Promise<T>,
) => Promise<T>;

const runDirectly: RunAvatarOperation = (_name, operation) => operation();

async function chooseAvatar(page: Page, run = runDirectly) {
  await run("select-file", () =>
    page
      .getByLabel("Выбрать изображение для аватара")
      .setInputFiles(avatarFile),
  );
  const dialog = page.getByRole("dialog", { name: "Кадрировать аватар" });
  await run("wait-for-editor", () => ui(dialog).toBeVisible());
  const preview = dialog.locator("img");
  await run("wait-for-preview", () =>
    ui
      .poll(() =>
        preview.evaluate(
          (image: HTMLImageElement) =>
            image.complete && image.naturalWidth === 120,
        ),
      )
      .toBe(true),
  );
  return { dialog, preview };
}

for (const engine of ["chromium", "webkit"]) {
  async function openPage(existing = false, run = runDirectly) {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing avatar browser");
    const page = await run("open-page", () => browser.newPage());
    try {
      await run("navigate", () =>
        page.goto(existing ? `${url}?existing=1` : url),
      );
      await run("wait-for-avatar-button", () =>
        ui(
          page.getByRole("button", {
            name: existing ? "Заменить фото" : "Добавить фото",
          }),
        ).toBeVisible(),
      );
      return page;
    } catch (error) {
      await run("close-after-setup-failure", () => page.close());
      throw error;
    }
  }

  test(`${engine}: leaving before native image decoding releases its acquired URL inside teardown`, async () => {
    const page = await openPage();
    try {
      await page.locator("#leave").click();
      await ui(page.getByText("Другая страница")).toBeVisible();
      const acquired = await receipts(page);
      ui(acquired).toHaveLength(1);
      ui(acquired[0]).toMatchObject({ fileName: "first.png", released: true });
      await ui(page.getByLabel("Harness error")).toHaveText("");
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: retained crop releases resources while hidden, reacquires its preview and cancels normally`, async () => {
    const page = await openPage();
    try {
      const { dialog, preview } = await chooseAvatar(page);
      const retained = await dialog.elementHandle();
      const zoom = dialog.getByRole("slider", { name: "Масштаб" });
      await zoom.focus();
      await zoom.press("End");
      await ui(zoom).toHaveValue("4");
      const previousUrl = await preview.getAttribute("src");
      await captureState(page, engine, "crop-before-hide");
      await page.locator("#hide").evaluate((button: HTMLButtonElement) => {
        button.click();
      });
      ui(
        await retained.evaluate((element) => {
          if (!(element instanceof HTMLDialogElement))
            throw new Error("Retained element is not a dialog");
          return {
            connected: element.isConnected,
            open: element.open,
            modal: element.matches(":modal"),
          };
        }),
      ).toEqual({ connected: true, open: false, modal: false });
      ui((await receipts(page)).every((entry) => entry.released)).toBe(true);
      await captureState(page, engine, "crop-hidden");
      await page.locator("#show").click();
      await ui(dialog).toBeVisible();
      ui(
        await retained.evaluate(
          (element) => element === document.querySelector("dialog"),
        ),
      ).toBe(true);
      await ui(zoom).toHaveValue("4");
      await ui
        .poll(() =>
          preview.evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth === 120,
          ),
        )
        .toBe(true);
      ui(await preview.getAttribute("src")).not.toBe(previousUrl);
      ui(
        await preview.evaluate(async (image: HTMLImageElement) => {
          const response = await fetch(image.src);
          return response.ok && (await response.arrayBuffer()).byteLength > 0;
        }),
      ).toBe(true);
      await captureState(page, engine, "crop-returned");
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      await ui(dialog).toBeHidden();
      ui((await inspect(page)).every((entry) => entry.released)).toBe(true);
      await captureState(page, engine, "crop-cancelled");
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: the latest actual file owns the preview when selections happen before decode`, async () => {
    const page = await openPage();
    try {
      await page.locator("#latest").click();
      const dialog = page.getByRole("dialog", { name: "Кадрировать аватар" });
      await ui(dialog).toBeVisible();
      const immediate = await receipts(page);
      ui(immediate[0]).toMatchObject({
        fileName: "first.png",
        released: true,
      });
      const previewUrl = await dialog.locator("img").getAttribute("src");
      const acquired = await inspect(page);
      ui(acquired.find((entry) => entry.url === previewUrl)).toMatchObject({
        fileName: "latest.png",
        released: false,
      });
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      await ui(dialog).toBeHidden();
      ui((await inspect(page)).every((entry) => entry.released)).toBe(true);
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: a rejected later file cancels pending decoding without reopening the crop`, async () => {
    const page = await openPage();
    try {
      await page.locator("#invalid").click();
      await ui(page.getByLabel("URL receipts")).not.toHaveText("[]");
      const immediate = await receipts(page);
      ui(immediate).toHaveLength(1);
      ui(immediate[0]).toMatchObject({
        fileName: "first.png",
        released: true,
      });
      await ui(page.getByRole("alert")).toHaveText(
        "Выберите JPEG, PNG или WebP размером до 10 МБ.",
      );
      await ui(page.getByRole("dialog")).toHaveCount(0);
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: cancelling the crop also disposes a later native image read`, async () => {
    const page = await openPage();
    try {
      const { dialog } = await chooseAvatar(page);
      await page.locator("#cancel").evaluate((button: HTMLButtonElement) => {
        button.click();
      });
      await ui(page.getByLabel("URL receipts")).not.toHaveText("[]");
      const immediate = await receipts(page);
      ui(
        immediate.find((entry) => entry.fileName === "pending.png"),
      ).toMatchObject({
        released: true,
      });
      ui(immediate.every((entry) => entry.released)).toBe(true);
      await ui(dialog).toBeHidden();
      await ui(page.getByLabel("Harness error")).toHaveText("");
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: committing the current crop keeps upload pending despite a later native image read`, async () => {
    const page = await openPage();
    const pending: { route?: Route; body?: string | null } = {};
    try {
      const { dialog } = await chooseAvatar(page);
      await page.route("**/account/avatar", (route) => {
        pending.body = route.request().postData();
        pending.route = route;
      });
      await page.locator("#upload").evaluate((button: HTMLButtonElement) => {
        button.click();
      });
      await ui.poll(() => pending.route !== undefined).toBe(true);
      ui(pending.route?.request().method()).toBe("PUT");
      ui(pending.body).toContain('filename="account-avatar.png"');
      await ui
        .poll(
          async () =>
            (await inspect(page)).find(
              (entry) => entry.fileName === "pending.png",
            )?.released,
        )
        .toBe(true);
      await ui(
        dialog.getByRole("button", { name: "Закрыть кадрирование" }),
      ).toBeDisabled();
      await dialog.press("Escape");
      await ui(dialog).toBeVisible();
      const route = pending.route;
      if (route === undefined) throw new Error("Missing real avatar request");
      delete pending.route;
      await route.fulfill({
        status: 200,
        json: uploadResponse,
      });
      await ui(dialog).toBeHidden();
      await ui(
        page.getByRole("status").filter({ hasText: "Аватар сохранён." }),
      ).toHaveText("Аватар сохранён.");
      ui((await inspect(page)).every((entry) => entry.released)).toBe(true);
    } finally {
      try {
        if (pending.route !== undefined) await pending.route.abort();
      } finally {
        await page.close();
      }
    }
  }, 30_000);

  test(`${engine}: removing the avatar cancels pending native image reading and stays busy until the response`, async () => {
    const page = await openPage(true);
    const pending: { route?: Route; body?: string | null } = {};
    try {
      await page.route("**/account/avatar", (route) => {
        pending.body = route.request().postData();
        pending.route = route;
      });
      await page.locator("#remove").click();
      await ui.poll(() => pending.route !== undefined).toBe(true);
      ui(pending.route?.request().method()).toBe("DELETE");
      ui(JSON.parse(pending.body ?? "null")).toEqual({ expectedVersion: 1 });
      ui(
        (await receipts(page)).find((entry) => entry.fileName === "first.png"),
      ).toMatchObject({ released: true });
      await ui(
        page.getByRole("button", { name: "Удаляем…", exact: true }),
      ).toBeDisabled();
      await ui(page.getByRole("dialog")).toHaveCount(0);
      const route = pending.route;
      if (route === undefined)
        throw new Error("Missing actual removal request");
      delete pending.route;
      await route.fulfill({
        status: 200,
        json: { profile: { ...uploadResponse.profile, avatar: null } },
      });
      await ui(
        page.getByRole("status").filter({ hasText: "Аватар удалён." }),
      ).toHaveText("Аватар удалён.");
      ui((await inspect(page)).every((entry) => entry.released)).toBe(true);
    } finally {
      try {
        if (pending.route !== undefined) await pending.route.abort();
      } finally {
        await page.close();
      }
    }
  }, 30_000);

  test(`${engine}: a pointer held across hide cannot drag the returned crop without a new press`, async (t) => {
    const directory = resolve(
      import.meta.dirname,
      "../../test-results/browser-engines/account-avatar/held-pointer",
      engine,
    );
    const failureReport = resolve(directory, "failure.json");
    try {
      rmSync(failureReport, { force: true });
    } catch (error) {
      console.error(
        "[account-avatar held pointer diagnostics cleanup unavailable]",
        error instanceof Error ? error.name : "unknown",
      );
    }
    const started = performance.now();
    const operations: {
      name: string;
      startedMilliseconds: number;
      endedMilliseconds: number | null;
    }[] = [];
    const run: RunAvatarOperation = async (name, operation) => {
      const entry: (typeof operations)[number] = {
        name,
        startedMilliseconds: performance.now() - started,
        endedMilliseconds: null,
      };
      operations.push(entry);
      try {
        return await operation();
      } finally {
        entry.endedMilliseconds = performance.now() - started;
      }
    };
    t.onTestFailed(async () => {
      const snapshot = JSON.stringify(
        {
          engine,
          elapsedMilliseconds: performance.now() - started,
          browserConnected: browsers.get(engine)?.isConnected() ?? null,
          operations,
        },
        null,
        2,
      );
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(failureReport, snapshot + "\n");
      } catch (error) {
        console.error(
          "[account-avatar held pointer diagnostics unavailable]",
          error instanceof Error ? error.name : "unknown",
        );
      }
    });
    const page = await openPage(false, run);
    try {
      const { dialog } = await chooseAvatar(page, run);
      const zoom = dialog.getByRole("slider", { name: "Масштаб" });
      await run("focus-zoom", () => zoom.focus());
      await run("set-zoom", () => zoom.press("End"));
      await run("wait-for-zoom", () => ui(zoom).toHaveValue("4"));
      const crop = dialog.getByRole("group");
      const bounds = await run("measure-crop", () => crop.boundingBox());
      if (bounds === null) throw new Error("Missing crop geometry");
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      const captured = await run("observe-pointerdown", () =>
        crop.evaluateHandle((element) => {
          if (!(element instanceof HTMLDivElement))
            throw new Error("Missing native crop element");
          const receipt: { pointerId: number | null } = { pointerId: null };
          element.addEventListener(
            "pointerdown",
            (event) => {
              receipt.pointerId = event.pointerId;
            },
            { once: true },
          );
          return receipt;
        }),
      );
      const cropHandle = await run("get-crop-element", () =>
        crop.elementHandle(),
      );
      await run("move-to-crop", () => page.mouse.move(x, y));
      await run("initial-pointer-down", () => page.mouse.down());
      await run("initial-pointer-move", () => page.mouse.move(x + 20, y));
      const pointerId = await run("read-pointer-id", () =>
        captured.evaluate((receipt) => receipt.pointerId),
      );
      if (pointerId === null)
        throw new Error("Native pointer was not acquired");
      ui(
        await run("read-capture-before-hide", () =>
          cropHandle.evaluate(
            (element, id) => element.hasPointerCapture(id),
            pointerId,
          ),
        ),
      ).toBe(true);
      await run("inspect-initial-drag", () => inspect(page));
      const horizontal = dialog.getByRole("slider", { name: "По горизонтали" });
      const before = await run("read-initial-drag", () =>
        horizontal.inputValue(),
      );
      await run("hide", () =>
        page.locator("#hide").evaluate((button: HTMLButtonElement) => {
          button.click();
        }),
      );
      ui(
        await run("read-capture-after-hide", () =>
          cropHandle.evaluate(
            (element, id) => element.hasPointerCapture(id),
            pointerId,
          ),
        ),
      ).toBe(false);
      await run("show", () =>
        page.locator("#show").evaluate((button: HTMLButtonElement) => {
          button.click();
        }),
      );
      await run("wait-for-returned-editor", () => ui(dialog).toBeVisible());
      await run("held-pointer-move", () => page.mouse.move(x + 40, y));
      await run("inspect-held-drag", () => inspect(page));
      await run("check-held-drag", () => ui(horizontal).toHaveValue(before));
      await run("release-held-pointer", () => page.mouse.up());
      await run("new-pointer-down", () => page.mouse.down());
      await run("new-pointer-move", () => page.mouse.move(x + 60, y));
      await run("inspect-new-drag", () => inspect(page));
      ui(await run("read-new-drag", () => horizontal.inputValue())).not.toBe(
        before,
      );
    } finally {
      await run("cleanup-release-pointer", () => page.mouse.up());
      await run("cleanup-close-page", () => page.close());
    }
  }, 30_000);
}
