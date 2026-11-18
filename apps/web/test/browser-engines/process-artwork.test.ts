import { expect as browserExpect } from "@playwright/test";
import { afterAll, beforeAll, test } from "vitest";

import {
  createOwnedBrowserFixture,
  type BrowserFixture,
} from "../support/owned-browser-fixture";

interface ArtworkResources {
  readonly intersection: number;
  readonly frames: number;
  readonly visibility: number;
  readonly media: number;
  readonly executedFrames: number;
}
declare global {
  interface Window {
    processArtworkResources?: () => ArtworkResources;
  }
}

/** Passive native accounting; every registration and callback still reaches the real browser. */
function observeArtworkResources() {
  const intersection = new Map<IntersectionObserver, Set<Element>>();
  const frames = new Set<number>();
  const visibility = new Set<EventListenerOrEventListenerObject>();
  const media = new Map<EventTarget, Set<EventListenerOrEventListenerObject>>();
  let executedFrames = 0;
  const add: unknown = Object.getOwnPropertyDescriptor(
    EventTarget.prototype,
    "addEventListener",
  )?.value;
  const remove: unknown = Object.getOwnPropertyDescriptor(
    EventTarget.prototype,
    "removeEventListener",
  )?.value;
  if (typeof add !== "function" || typeof remove !== "function")
    throw new Error("Native EventTarget unavailable");
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    Reflect.apply(add, this, [type, listener, options]);
    if (listener === null) return;
    if (this === document && type === "visibilitychange")
      visibility.add(listener);
    if (
      this instanceof MediaQueryList &&
      this.media === "(prefers-reduced-motion: reduce)" &&
      type === "change"
    ) {
      const listeners =
        media.get(this) ?? new Set<EventListenerOrEventListenerObject>();
      listeners.add(listener);
      media.set(this, listeners);
    }
  };
  EventTarget.prototype.removeEventListener = function (
    type,
    listener,
    options,
  ) {
    Reflect.apply(remove, this, [type, listener, options]);
    if (listener === null) return;
    if (this === document && type === "visibilitychange")
      visibility.delete(listener);
    if (
      this instanceof MediaQueryList &&
      this.media === "(prefers-reduced-motion: reduce)" &&
      type === "change"
    ) {
      const listeners = media.get(this);
      listeners?.delete(listener);
      if (listeners?.size === 0) media.delete(this);
    }
  };
  const NativeIntersection = window.IntersectionObserver;
  window.IntersectionObserver = class extends NativeIntersection {
    override observe(element: Element) {
      super.observe(element);
      const targets = intersection.get(this) ?? new Set<Element>();
      targets.add(element);
      intersection.set(this, targets);
    }
    override unobserve(element: Element) {
      super.unobserve(element);
      const targets = intersection.get(this);
      targets?.delete(element);
      if (targets?.size === 0) intersection.delete(this);
    }
    override disconnect() {
      super.disconnect();
      intersection.delete(this);
    }
  };
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    const frame = request(function (this: unknown, time) {
      frames.delete(frame);
      executedFrames += 1;
      Reflect.apply(callback, this, [time]);
    });
    frames.add(frame);
    return frame;
  };
  window.cancelAnimationFrame = (frame) => {
    cancel(frame);
    frames.delete(frame);
  };
  window.processArtworkResources = () => ({
    intersection: intersection.size,
    frames: frames.size,
    visibility: visibility.size,
    media: media.size,
    executedFrames,
  });
}

const owner = createOwnedBrowserFixture("process-artwork");
let fixture: BrowserFixture;
beforeAll(async () => {
  fixture = await owner.start();
}, 30_000);
afterAll(async () => {
  await owner.close();
}, 10_000);
for (const engine of ["chromium", "webkit"] as const) {
  test(`${engine}: real artwork pauses offscreen, changes native motion and releases retained resources`, async () => {
    const browser = fixture.browsers.get(engine);
    if (browser === undefined) throw new Error("Missing artwork engine");
    const context = await browser.newContext({
      viewport: { width: 900, height: 700 },
      reducedMotion: "no-preference",
    });
    try {
      const page = await context.newPage();
      await page.addInitScript(observeArtworkResources);
      await page.goto(fixture.url);
      const host = page.locator(".ai-process-artwork");
      const stage = host.locator(".stage");
      const resources = () =>
        page.evaluate(() => window.processArtworkResources?.());
      await browserExpect(stage).toHaveAttribute("data-scene", "1");
      await browserExpect
        .poll(resources)
        .toMatchObject({ intersection: 1, frames: 1, visibility: 1, media: 1 });
      await browserExpect
        .poll(() => host.locator(".scene-1 .type").textContent())
        .toContain("Добавь");
      const savedStage = await stage.elementHandle();
      await page
        .getByRole("button", { name: "Move offscreen", exact: true })
        .click();
      await browserExpect(stage).toHaveClass(/is-paused/u);
      await browserExpect
        .poll(resources)
        .toMatchObject({ frames: 0, intersection: 1 });
      const stoppedFrames = (await resources())?.executedFrames ?? 0;
      await page
        .getByRole("button", { name: "Restore artwork", exact: true })
        .click();
      await browserExpect.poll(resources).toMatchObject({ frames: 1 });
      await browserExpect
        .poll(async () => (await resources())?.executedFrames ?? 0)
        .toBeGreaterThan(stoppedFrames);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await browserExpect(stage).toHaveAttribute("data-scene", "5");
      await browserExpect(stage).toHaveClass(/is-static/u);
      await browserExpect.poll(resources).toMatchObject({ frames: 0 });
      await page
        .getByRole("button", { name: "Static scene 2", exact: true })
        .click();
      await browserExpect(stage).toHaveAttribute("data-scene", "2");
      await page
        .getByRole("button", { name: "Static scene 4", exact: true })
        .click();
      await browserExpect(stage).toHaveAttribute("data-scene", "4");
      await page
        .getByRole("button", { name: "Hide artwork", exact: true })
        .click();
      await browserExpect(host).toBeHidden();
      await browserExpect
        .poll(resources)
        .toMatchObject({ intersection: 0, frames: 0, visibility: 0, media: 0 });
      await page
        .getByRole("button", { name: "Return artwork", exact: true })
        .click();
      await browserExpect(stage).toHaveAttribute("data-scene", "4");
      await browserExpect
        .poll(resources)
        .toMatchObject({ intersection: 1, frames: 0, visibility: 1, media: 1 });
      await browserExpect
        .poll(() =>
          savedStage.evaluate(
            (element) =>
              element === document.querySelector(".ai-process-artwork .stage"),
          ),
        )
        .toBe(true);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page
        .getByRole("button", { name: "Animate once", exact: true })
        .click();
      await browserExpect(stage).toHaveAttribute("data-scene", "1");
      await browserExpect.poll(resources).toMatchObject({ frames: 1 });
      await page
        .getByRole("button", { name: "Remove artwork", exact: true })
        .click();
      await browserExpect(host).toHaveCount(0);
      await browserExpect
        .poll(resources)
        .toMatchObject({ intersection: 0, frames: 0, visibility: 0, media: 0 });
      await savedStage.dispose();
    } finally {
      await context.close();
    }
  }, 20_000);

  test(`${engine}: the genuine non-looping scene clock stops at its existing end`, async () => {
    const browser = fixture.browsers.get(engine);
    if (browser === undefined) throw new Error("Missing artwork engine");
    const context = await browser.newContext({
      viewport: { width: 900, height: 700 },
      reducedMotion: "no-preference",
    });
    try {
      const page = await context.newPage();
      await page.addInitScript(observeArtworkResources);
      await page.goto(fixture.url);
      await page
        .getByRole("button", { name: "Animate once", exact: true })
        .click();
      const stage = page.locator(".ai-process-artwork .stage");
      await browserExpect(stage).toHaveAttribute("data-scene", "1");
      await browserExpect
        .poll(() => page.evaluate(() => window.processArtworkResources?.()))
        .toMatchObject({ frames: 1 });
      await browserExpect(stage).toHaveClass(/is-paused/u, { timeout: 27_000 });
      await browserExpect(stage).toHaveAttribute("data-scene", "5");
      await browserExpect
        .poll(() => page.evaluate(() => window.processArtworkResources?.()))
        .toMatchObject({ frames: 0 });
    } finally {
      await context.close();
    }
  }, 30_000);
}
