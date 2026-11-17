import { expect as ui, type Browser } from "@playwright/test";
import { afterAll, beforeAll, test } from "vitest";

import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";

const fixture = createOwnedBrowserFixture("native-dialog");
let browsers: ReadonlyMap<string, Browser> = new Map();
let url = "";
beforeAll(async () => {
  const started = await fixture.start();
  browsers = started.browsers;
  url = started.url;
}, 30_000);
afterAll(() => fixture.close(), 30_000);

for (const engine of ["chromium", "webkit"]) {
  test(`${engine}: hidden pending dialog releases its native layer and returns with its draft`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing native dialog browser");
    const page = await browser.newPage();
    try {
      await page.goto(url);
      await page
        .getByRole("checkbox", { name: "Операция выполняется" })
        .check();
      await page.getByRole("button", { name: "Вернуться к форме" }).click();
      const dialog = page.getByRole("dialog", { name: "Сохранённая форма" });
      const input = dialog.getByRole("textbox", { name: "Название" });
      await input.fill("Сохранённый черновик");
      await input.press("Escape");
      await ui(dialog).toBeVisible();
      await ui(
        dialog.getByRole("button", { name: "Закрыть", exact: true }),
      ).toBeDisabled();
      const retained = await page.$("dialog");
      if (retained === null) throw new Error("Missing open dialog element");
      await dialog.getByRole("button", { name: "Другая страница" }).click();
      await ui
        .poll(() => retained.evaluate((element) => element.matches(":modal")))
        .toBe(false);
      await ui(page.getByLabel("Состояние формы")).toHaveText("Открыта");
      await page.getByRole("button", { name: "Вернуться к форме" }).click();
      await ui(dialog).toBeVisible();
      await ui
        .poll(() =>
          retained.evaluate(
            (element) =>
              element === document.querySelector("dialog") &&
              element.matches(":modal"),
          ),
        )
        .toBe(true);
      await ui(input).toHaveValue("Сохранённый черновик");
      await dialog
        .getByRole("button", { name: "Операция завершилась" })
        .click();
      await input.press("Escape");
      await ui(dialog).toBeHidden();
      await ui(page.getByLabel("Состояние формы")).toHaveText("Закрыта");
    } finally {
      await page.close();
    }
  }, 30_000);

  test(`${engine}: queued lifetime acknowledgements preserve open state and unmount closes the physical dialog`, async () => {
    const browser = browsers.get(engine);
    if (browser === undefined) throw new Error("Missing native dialog browser");
    const page = await browser.newPage();
    try {
      await page.goto(url);
      await page.getByRole("button", { name: "Вернуться к форме" }).click();
      const dialog = page.getByRole("dialog", { name: "Сохранённая форма" });
      const retained = await page.$("dialog");
      if (retained === null) throw new Error("Missing open dialog element");
      const receipts = await retained.evaluate(
        (element) =>
          new Promise<number>((resolve) => {
            let count = 0;
            const onClose = () => {
              count += 1;
              if (count === 2) {
                element.removeEventListener("close", onClose);
                resolve(count);
              }
            };
            element.addEventListener("close", onClose);
            const button = Array.from(element.querySelectorAll("button")).find(
              (candidate) => candidate.textContent === "Два перехода",
            );
            if (button === undefined)
              throw new Error("Missing lifetime transition control");
            button.click();
          }),
      );
      ui(receipts).toBe(2);
      await ui(page.getByLabel("Состояние формы")).toHaveText("Открыта");
      await ui
        .poll(() => retained.evaluate((element) => element.matches(":modal")))
        .toBe(false);
      await page.getByRole("button", { name: "Вернуться к форме" }).click();
      await ui(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Удалить форму" }).click();
      await ui
        .poll(() =>
          retained.evaluate((element) => ({
            connected: element.isConnected,
            open: element.open,
            modal: element.matches(":modal"),
          })),
        )
        .toEqual({ connected: false, open: false, modal: false });
    } finally {
      await page.close();
    }
  }, 30_000);
}
