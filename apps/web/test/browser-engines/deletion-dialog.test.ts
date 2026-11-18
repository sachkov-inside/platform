import { expect as ui, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, test } from "vitest";

import { createOwnedBrowserFixture } from "../support/owned-browser-fixture";

const fixture = createOwnedBrowserFixture("deletion-dialog");
let browsers: ReadonlyMap<string, Browser> = new Map();
let url = "";
beforeAll(async () => {
  const started = await fixture.start();
  browsers = started.browsers;
  url = started.url;
}, 30_000);
afterAll(() => fixture.close(), 30_000);

type Kind = "draft" | "controlled" | "removal";
async function open(page: Page, kind: Kind, pending: boolean) {
  await page.goto(`${url}?kind=${kind}&pending=${pending ? "1" : "0"}`);
  if (kind === "draft")
    await page.getByRole("button", { name: "Удалить черновик" }).click();
  if (kind === "controlled")
    await page.getByRole("button", { name: "Вернуть диалог" }).click();
  const dialog = page.locator("dialog");
  await ui(dialog).toBeVisible();
  await ui
    .poll(() => dialog.evaluate((node) => node.matches(":modal")))
    .toBe(true);
  return dialog;
}

for (const engine of ["chromium", "webkit"])
  for (const kind of ["draft", "controlled", "removal"] as const) {
    for (const pending of [false, true]) {
      test(`${engine}: ${kind} trusted Escape preserves pending=${String(pending)} cancel policy`, async () => {
        const browser = browsers.get(engine);
        if (browser === undefined) throw new Error("Missing deletion browser");
        const page = await browser.newPage();
        try {
          const dialog = await open(page, kind, pending);
          if (pending) {
            await ui(dialog.getByRole("button").first()).toBeDisabled();
            await ui(dialog.getByRole("button").last()).toBeDisabled();
          }
          await ui
            .poll(() =>
              dialog.evaluate(
                (node) =>
                  node === document.activeElement ||
                  node.contains(document.activeElement),
              ),
            )
            .toBe(true);
          await dialog.evaluate((node) => {
            node.addEventListener(
              "cancel",
              (event) => {
                node.setAttribute(
                  "data-observed-native-cancel",
                  String(event.isTrusted),
                );
              },
              { once: true },
            );
          });
          const retained = await dialog.elementHandle();
          await page.keyboard.press("Escape");
          await ui
            .poll(() => retained.evaluate((node) => node.matches(":modal")))
            .toBe(false);
          ui(await retained.getAttribute("data-observed-native-cancel")).toBe(
            "true",
          );
          await ui(page.getByLabel("Отмены")).toHaveText("1");
          await ui(page.getByLabel("Подтверждения")).toHaveText("0");
        } finally {
          await page.close();
        }
      }, 30_000);
    }

    test(`${engine}: ${kind} retains its native dialog and releases its active unmount`, async () => {
      const browser = browsers.get(engine);
      if (browser === undefined) throw new Error("Missing deletion browser");
      const page = await browser.newPage();
      try {
        const dialog = await open(page, kind, false);
        if (kind !== "removal") await dialog.getByRole("checkbox").check();
        const retained = await dialog.elementHandle();
        const confirm = dialog.getByRole("button", {
          name:
            kind === "removal" ? "Снять из продукта" : "Удалить безвозвратно",
        });
        await confirm.click();
        await ui(dialog).toBeHidden();
        await ui
          .poll(() => retained.evaluate((node) => node.matches(":modal")))
          .toBe(false);
        ui(await retained.evaluate((node) => node.isConnected)).toBe(true);
        await ui(page.getByLabel("Отмены")).toHaveText("0");
        await ui(page.getByLabel("Подтверждения")).toHaveText("1");
        if (kind !== "removal")
          ui(JSON.parse(await page.getByLabel("Запрос").innerText())).toEqual({
            deleteVideoId: "02000000-0000-4000-8000-000000000003",
            expectedContentVersion: 7,
            materialId: "02000000-0000-4000-8000-000000000001",
            submissionId: "02000000-0000-4000-8000-000000000002",
          });
        await page.getByRole("button", { name: "Вернуть диалог" }).click();
        await ui(dialog).toBeVisible();
        ui(
          await retained.evaluate(
            (node) => node === document.querySelector("dialog"),
          ),
        ).toBe(true);
        if (kind !== "removal")
          await ui(dialog.getByRole("checkbox")).toBeChecked();
        await confirm.click();
        await ui
          .poll(() =>
            retained.evaluate((node) => {
              if (!(node instanceof HTMLDialogElement))
                throw new Error("Retained element is not a native dialog");
              return {
                connected: node.isConnected,
                open: node.open,
                modal: node.matches(":modal"),
              };
            }),
          )
          .toEqual({ connected: false, open: false, modal: false });
        await ui(page.getByLabel("Отмены")).toHaveText("0");
        await ui(page.getByLabel("Подтверждения")).toHaveText("2");
      } finally {
        await page.close();
      }
    }, 30_000);
  }
