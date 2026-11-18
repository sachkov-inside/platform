import { expect as browserExpect } from "@playwright/test";
import { afterAll, beforeAll, test } from "vitest";

import {
  createOwnedBrowserFixture,
  type BrowserFixture,
} from "../support/owned-browser-fixture";

declare global {
  interface Window {
    materialOrderPointerListeners?: () => number;
  }
}

function observePointerListeners() {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    Reflect.apply(add, this, [type, listener, options]);
    if (
      this !== window ||
      listener === null ||
      !["pointermove", "pointerup", "pointercancel"].includes(type)
    )
      return;
    const entries =
      listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    entries.add(listener);
    listeners.set(type, entries);
  };
  EventTarget.prototype.removeEventListener = function (
    type,
    listener,
    options,
  ) {
    Reflect.apply(remove, this, [type, listener, options]);
    if (this === window && listener !== null)
      listeners.get(type)?.delete(listener);
  };
  window.materialOrderPointerListeners = () =>
    [...listeners.values()].reduce((total, entries) => total + entries.size, 0);
}

const owner = createOwnedBrowserFixture("material-order");
let fixture: BrowserFixture;
beforeAll(async () => {
  fixture = await owner.start();
}, 30_000);
afterAll(async () => {
  await owner.close();
}, 10_000);

for (const engine of ["chromium", "webkit"] as const) {
  test(`${engine}: retained hide cancels an unfinished mouse drag without changing the steps`, async () => {
    const browser = fixture.browsers.get(engine);
    if (browser === undefined) throw new Error("Missing MaterialOrder engine");
    const context = await browser.newContext({
      viewport: { width: 900, height: 700 },
    });
    try {
      const page = await context.newPage();
      await page.addInitScript(observePointerListeners);
      await page.goto(fixture.url);
      const pointerListeners = () =>
        page.evaluate(() => window.materialOrderPointerListeners?.());
      const list = page.locator("[data-exercise-steps]");
      const steps = list.locator("[data-order-step]");
      const labels = () =>
        steps
          .locator(
            "[id$='-step-0'], [id$='-step-1'], [id$='-step-2'], [id$='-step-3']",
          )
          .allTextContents();
      await browserExpect(steps).toHaveCount(4);
      await browserExpect
        .poll(labels)
        .toEqual([
          "Сохранить векторы в индекс",
          "Посчитать эмбеддинги чанков",
          "Нарезать документы на чанки",
          "Найти ближайшие чанки к вопросу",
        ]);
      const originalList = await list.elementHandle();
      if (originalList === null) throw new Error("Missing exercise list");
      await page
        .getByRole("button", { name: "Hide exercise", exact: true })
        .focus();
      const handle = await steps
        .nth(0)
        .locator("[data-order-handle]")
        .boundingBox();
      if (handle === null) throw new Error("Missing drag handle");
      await page.mouse.move(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2 + 110,
      );
      await browserExpect(list.locator("[data-dragging]")).toHaveCount(1);
      await browserExpect.poll(pointerListeners).toBe(3);
      await browserExpect(
        page.getByRole("button", { name: "Hide exercise", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await browserExpect(list).toBeHidden();
      await browserExpect.poll(pointerListeners).toBe(0);
      await page
        .getByRole("button", { name: "Return exercise", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await browserExpect(list).toBeVisible();
      await browserExpect.poll(pointerListeners).toBe(0);
      console.log(
        JSON.stringify({
          engine,
          stage: "returned",
          pointerListeners: await pointerListeners(),
          dragMarkers: await list.locator("[data-dragging]").count(),
        }),
      );
      await browserExpect
        .poll(() =>
          originalList.evaluate(
            (element) =>
              element === document.querySelector("[data-exercise-steps]"),
          ),
        )
        .toBe(true);
      await browserExpect(list.locator("[data-dragging]")).toHaveCount(0);
      await page.mouse.move(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2 + 160,
      );
      await page.mouse.up();
      await browserExpect
        .poll(labels)
        .toEqual([
          "Сохранить векторы в индекс",
          "Посчитать эмбеддинги чанков",
          "Нарезать документы на чанки",
          "Найти ближайшие чанки к вопросу",
        ]);
      await originalList.dispose();
    } finally {
      await context.close();
    }
  }, 15_000);
}
