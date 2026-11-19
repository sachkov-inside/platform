import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect as browserExpect, type Video } from "@playwright/test";
import { afterAll, beforeAll, test } from "vitest";

import {
  type FirstTextAssertion,
  createFirstTextTrace,
  saveFirstTextFailure,
} from "../support/artwork-first-text";
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

function observeArtworkResources() {
  const intersection = new Map<IntersectionObserver, Set<Element>>();
  const frames = new Set<number>();
  const visibility = new Set<EventListenerOrEventListenerObject>();
  const media = new Map<EventTarget, Set<EventListenerOrEventListenerObject>>();
  let executedFrames = 0;
  let insideClockTrigger = false;
  const visibilityHandlers = new WeakMap<
    EventListenerOrEventListenerObject,
    EventListener
  >();
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
    let registered = listener;
    if (
      listener &&
      this === document &&
      type === "visibilitychange" &&
      window.artworkFirstText
    ) {
      let handler = visibilityHandlers.get(listener);
      if (!handler) {
        handler = function (this: EventTarget, event) {
          const previous = insideClockTrigger;
          insideClockTrigger = true;
          try {
            if (typeof listener === "function") listener.call(this, event);
            else listener.handleEvent(event);
          } finally {
            insideClockTrigger = previous;
          }
        };
        visibilityHandlers.set(listener, handler);
      }
      registered = handler;
    }
    Reflect.apply(add, this, [type, registered, options]);
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
    const registered =
      this === document && type === "visibilitychange" && listener
        ? (visibilityHandlers.get(listener) ?? listener)
        : listener;
    Reflect.apply(remove, this, [type, registered, options]);
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
  const artworkCallbacks = new WeakSet<FrameRequestCallback>();
  window.IntersectionObserver = class extends NativeIntersection {
    constructor(
      callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit,
    ) {
      super((entries, observer) => {
        const trace = window.artworkFirstText;
        const entry =
          trace &&
          entries.find(({ target }) => target.matches(".ai-process-artwork"));
        if (entry) trace.intersection(entry.isIntersecting);
        const previous = insideClockTrigger;
        insideClockTrigger ||= Boolean(entry);
        try {
          callback.call(observer, entries, observer);
        } finally {
          insideClockTrigger = previous;
        }
      }, options);
    }
    override observe(element: Element) {
      if (element.matches(".ai-process-artwork"))
        window.artworkFirstText?.observe(element);
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
  let insideFirstTick = false;
  window.requestAnimationFrame = (callback) => {
    if (insideClockTrigger) artworkCallbacks.add(callback);
    const clock = artworkCallbacks.has(callback)
      ? window.artworkFirstText
      : undefined;
    const slot = clock?.request(insideFirstTick);
    const frame = request(function (this: unknown, time) {
      frames.delete(frame);
      executedFrames += 1;
      clock?.frame(time);
      if (slot) slot.callbackEnteredAt = performance.now();
      const previous = insideFirstTick;
      insideFirstTick = slot?.ordinal === 1;
      try {
        Reflect.apply(callback, this, [time]);
      } finally {
        insideFirstTick = previous;
      }
    });
    frames.add(frame);
    if (slot) slot.handle = frame;
    return frame;
  };
  window.cancelAnimationFrame = (frame) => {
    cancel(frame);
    window.artworkFirstText?.cancel(frame);
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
    let completed = false;
    try {
      const page = await context.newPage();
      if (engine === "webkit") await page.addInitScript(createFirstTextTrace);
      await page.addInitScript(observeArtworkResources);
      await page.goto(fixture.url);
      const host = page.locator(".ai-process-artwork");
      const stage = host.locator(".stage");
      const resources = () =>
        page.evaluate(() => window.processArtworkResources?.());
      let assertion: FirstTextAssertion = "scene";
      try {
        await browserExpect(stage).toHaveAttribute("data-scene", "1");
        assertion = "resources";
        await browserExpect.poll(resources).toMatchObject({
          intersection: 1,
          frames: 1,
          visibility: 1,
          media: 1,
        });
        assertion = "first-text";
        await browserExpect
          .poll(() => host.locator(".scene-1 .type").textContent())
          .toContain("Добавь");
      } catch (error) {
        if (engine === "webkit")
          await saveFirstTextFailure(page, assertion).catch(() => {
            console.warn(
              "[process-artwork] Could not save first-text diagnostics",
            );
          });
        throw error;
      }
      if (engine === "webkit")
        await page.evaluate(() => window.artworkFirstText?.stop());
      const savedStage = await stage.elementHandle();
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
      await browserExpect(stage).toHaveAttribute("data-scene", "1");
      await browserExpect
        .poll(resources)
        .toMatchObject({ intersection: 1, frames: 1, visibility: 1, media: 1 });
      await browserExpect
        .poll(() => host.locator(".scene-1 .type").textContent())
        .toContain("Добавь");
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
      await browserExpect
        .poll(() =>
          savedStage.evaluate((element) => ({
            connected: element.isConnected,
            className: element.getAttribute("class"),
            scene: element.getAttribute("data-scene"),
            active: element.querySelectorAll(
              ".scene.is-active, .scene.is-leaving, .caret.is-on",
            ).length,
            text: element.querySelector(".scene-1 .type")?.textContent,
          })),
        )
        .toEqual({
          connected: false,
          className: "stage",
          scene: null,
          active: 0,
          text: "Добавь уведомления о новых заявках",
        });
      await savedStage.dispose();
      completed = true;
    } finally {
      await context.close().catch((error: unknown) => {
        if (completed) throw error;
      });
    }
  }, 20_000);

  test(`${engine}: the genuine non-looping scene clock stops at its existing end`, async () => {
    const browser = fixture.browsers.get(engine);
    if (browser === undefined) throw new Error("Missing artwork engine");
    const evidence =
      process.env["CAPTURE_EVIDENCE"] === "1"
        ? fileURLToPath(
            new URL(
              `../../../../.reports/process-artwork-lifetimes/engine-evidence/${engine}/`,
              import.meta.url,
            ),
          )
        : undefined;
    if (evidence !== undefined) await mkdir(evidence, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 900, height: 700 },
      reducedMotion: "no-preference",
      ...(evidence === undefined
        ? {}
        : {
            recordVideo: { dir: evidence, size: { width: 900, height: 700 } },
          }),
    });
    let video: Video | null = null;
    try {
      const page = await context.newPage();
      video = page.video();
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
      if (evidence !== undefined)
        await page.screenshot({ path: `${evidence}/stopped.png` });
    } finally {
      await context.close();
      if (evidence !== undefined)
        await video?.saveAs(`${evidence}/actual-once-cycle.webm`);
    }
  }, 30_000);
}
