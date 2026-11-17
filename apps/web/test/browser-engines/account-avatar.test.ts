import { fileURLToPath } from "node:url";
import { expect as ui, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, test } from "vitest";
import { z } from "zod";

import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";

const fixture = createOwnedBrowserFixture("account-avatar");
const avatarFile = fileURLToPath(
  new URL("../../public/images/sachkov-dev-avatar.webp", import.meta.url),
);
const receiptsSchema = z.array(
  z.object({
    url: z.string(),
    fileName: z.string().nullable(),
    released: z.boolean(),
  }),
);
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

async function chooseAvatar(page: Page) {
  await page
    .getByLabel("Выбрать изображение для аватара")
    .setInputFiles(avatarFile);
  const dialog = page.getByRole("dialog", { name: "Кадрировать аватар" });
  await ui(dialog).toBeVisible();
  const preview = dialog.locator("img");
  await ui
    .poll(() =>
      preview.evaluate(
        (image: HTMLImageElement) =>
          image.complete && image.naturalWidth === 120,
      ),
    )
    .toBe(true);
  return { dialog, preview };
}

for (const engine of ["chromium", "webkit"]) {
  async function openPage() {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing avatar browser");
    const page = await browser.newPage();
    try {
      await page.goto(url);
      await ui(
        page.getByRole("button", { name: "Добавить фото" }),
      ).toBeVisible();
      return page;
    } catch (error) {
      await page.close();
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
      ui(acquired[0]).toMatchObject({ fileName: "first.webp", released: true });
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
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      await ui(dialog).toBeHidden();
      ui((await inspect(page)).every((entry) => entry.released)).toBe(true);
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
        fileName: "first.webp",
        released: true,
      });
      const previewUrl = await dialog.locator("img").getAttribute("src");
      const acquired = await inspect(page);
      ui(acquired.find((entry) => entry.url === previewUrl)).toMatchObject({
        fileName: "latest.webp",
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
        fileName: "first.webp",
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
        immediate.find((entry) => entry.fileName === "pending.webp"),
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

  test(`${engine}: a pointer held across hide cannot drag the returned crop without a new press`, async () => {
    const page = await openPage();
    try {
      const { dialog } = await chooseAvatar(page);
      const zoom = dialog.getByRole("slider", { name: "Масштаб" });
      await zoom.focus();
      await zoom.press("End");
      await ui(zoom).toHaveValue("4");
      const crop = dialog.getByRole("group");
      const bounds = await crop.boundingBox();
      if (bounds === null) throw new Error("Missing crop geometry");
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      const captured = await crop.evaluateHandle((element) => {
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
      });
      const cropHandle = await crop.elementHandle();
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 20, y);
      const pointerId = await captured.evaluate((receipt) => receipt.pointerId);
      if (pointerId === null)
        throw new Error("Native pointer was not acquired");
      ui(
        await cropHandle.evaluate(
          (element, id) => element.hasPointerCapture(id),
          pointerId,
        ),
      ).toBe(true);
      await inspect(page);
      const horizontal = dialog.getByRole("slider", { name: "По горизонтали" });
      const before = await horizontal.inputValue();
      await page.locator("#hide").evaluate((button: HTMLButtonElement) => {
        button.click();
      });
      ui(
        await cropHandle.evaluate(
          (element, id) => element.hasPointerCapture(id),
          pointerId,
        ),
      ).toBe(false);
      await page.locator("#show").evaluate((button: HTMLButtonElement) => {
        button.click();
      });
      await ui(dialog).toBeVisible();
      await page.mouse.move(x + 40, y);
      await inspect(page);
      await ui(horizontal).toHaveValue(before);
      await page.mouse.up();
      await page.mouse.down();
      await page.mouse.move(x + 60, y);
      await inspect(page);
      ui(await horizontal.inputValue()).not.toBe(before);
    } finally {
      await page.mouse.up();
      await page.close();
    }
  }, 30_000);
}
