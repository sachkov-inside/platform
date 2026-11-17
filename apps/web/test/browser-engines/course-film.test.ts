import { expect as browserExpect } from "@playwright/test";
import { afterAll, beforeAll, test } from "vitest";
import {
  createOwnedBrowserFixture,
  type BrowserFixture,
} from "../support/owned-browser-fixture";

interface FilmResourceSnapshot {
  readonly resize: number;
  readonly intersection: number;
  readonly frames: number;
  readonly visibility: number;
  readonly media: number;
}
declare global {
  interface Window {
    courseFilmResourceSnapshot?: () => FilmResourceSnapshot;
    courseFilmFontsGate?: { release(): Promise<void> };
  }
}
function observeFilmResources() {
  const resize = new Map<ResizeObserver, Set<Element>>();
  const intersection = new Map<IntersectionObserver, Set<Element>>();
  const frames = new Set<number>();
  const visibility = new Set<EventListenerOrEventListenerObject>();
  const media = new Map<EventTarget, Set<EventListenerOrEventListenerObject>>();
  // oxlint-disable-next-line typescript/unbound-method -- Native observer forwards the actual target with call.
  const add = EventTarget.prototype.addEventListener;
  // oxlint-disable-next-line typescript/unbound-method -- Native observer forwards the actual target with call.
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    add.call(this, type, listener, options);
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
    remove.call(this, type, listener, options);
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
  const NativeResize = window.ResizeObserver;
  window.ResizeObserver = class extends NativeResize {
    override observe(element: Element, options?: ResizeObserverOptions) {
      super.observe(element, options);
      const targets = resize.get(this) ?? new Set<Element>();
      targets.add(element);
      resize.set(this, targets);
    }
    override unobserve(element: Element) {
      super.unobserve(element);
      const targets = resize.get(this);
      targets?.delete(element);
      if (targets?.size === 0) resize.delete(this);
    }
    override disconnect() {
      super.disconnect();
      resize.delete(this);
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
    const frame = request((time) => {
      frames.delete(frame);
      callback(time);
    });
    frames.add(frame);
    return frame;
  };
  window.cancelAnimationFrame = (frame) => {
    cancel(frame);
    frames.delete(frame);
  };
  window.courseFilmResourceSnapshot = () => ({
    resize: resize.size,
    intersection: intersection.size,
    frames: frames.size,
    visibility: visibility.size,
    media: media.size,
  });
}

function delayFilmFonts() {
  const nativeReady = document.fonts.ready;
  let release: () => void = () => undefined;
  const ready = new Promise<FontFaceSet>((resolve) => {
    release = () => {
      void nativeReady.then(resolve);
    };
  });
  Object.defineProperty(document.fonts, "ready", {
    configurable: true,
    get: () => ready,
  });
  window.courseFilmFontsGate = {
    async release() {
      release();
      await ready;
      await new Promise<void>((resolve) => {
        const checkpoint = new MessageChannel();
        checkpoint.port1.onmessage = () => {
          checkpoint.port1.close();
          checkpoint.port2.close();
          resolve();
        };
        checkpoint.port2.postMessage(null);
      });
    },
  };
}

function readCanvasImage(element: HTMLElement | SVGElement) {
  if (!(element instanceof HTMLCanvasElement))
    throw new Error("Expected Film Canvas");
  return element.toDataURL();
}
function readCanvasWidth(element: HTMLElement | SVGElement) {
  if (!(element instanceof HTMLCanvasElement))
    throw new Error("Expected Film Canvas");
  return element.width;
}
const owner = createOwnedBrowserFixture("course-film");
let fixture: BrowserFixture;
beforeAll(async () => {
  fixture = await owner.start();
}, 30_000);
afterAll(async () => {
  await owner.close();
}, 10_000);
for (const name of ["chromium", "webkit"] as const) {
  test(`${name}: static Film fits a height-changing slot with an opaque DPR-capped buffer`, async () => {
    const browser = fixture.browsers.get(name);
    if (browser === undefined) throw new Error("Missing Film engine");
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      deviceScaleFactor: 3,
    });
    try {
      const page = await context.newPage();
      await page.clock.install();
      await page.goto(fixture.url);
      const canvas = page.getByRole("img", {
        name: /Нужные файлы проекта копиями летят/,
      });
      await browserExpect
        .poll(() =>
          canvas.evaluate((element) => {
            if (!(element instanceof HTMLCanvasElement))
              throw new Error("Expected Film Canvas");
            const c = element;
            return [c.width, c.height];
          }),
        )
        .toEqual([640, 400]);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await browserExpect
        .poll(() =>
          canvas.evaluate((element) => {
            if (!(element instanceof HTMLCanvasElement))
              throw new Error("Expected Film Canvas");
            const c = element;
            const g = c.getContext("2d");
            return (
              [
                [0, 0],
                [639, 0],
                [0, 399],
                [639, 399],
              ] as const
            ).map(([x, y]) => g?.getImageData(x, y, 1, 1).data[3]);
          }),
        )
        .toEqual([255, 255, 255, 255]);
      const poster = await canvas.evaluate(readCanvasImage);
      await page.clock.runFor(1000);
      await browserExpect
        .poll(() => canvas.evaluate(readCanvasImage))
        .toBe(poster);
      await page.getByRole("button", { name: "Tall slot" }).click();
      await browserExpect
        .poll(() =>
          canvas.evaluate((element) => {
            if (!(element instanceof HTMLCanvasElement))
              throw new Error("Expected Film Canvas");
            const c = element;
            return [c.width, c.height];
          }),
        )
        .toEqual([640, 640]);
      await browserExpect
        .poll(() =>
          canvas.evaluate((element) => {
            if (!(element instanceof HTMLCanvasElement))
              throw new Error("Expected Film Canvas");
            const c = element;
            const g = c.getContext("2d");
            return (
              [
                [0, 0],
                [639, 0],
                [0, 639],
                [639, 639],
              ] as const
            ).map(([x, y]) => g?.getImageData(x, y, 1, 1).data[3]);
          }),
        )
        .toEqual([255, 255, 255, 255]);
    } finally {
      await context.close();
    }
  }, 30_000);
  test(`${name}: motion starts from the beginning and reduced motion restores the static poster`, async () => {
    const browser = fixture.browsers.get(name);
    if (browser === undefined) throw new Error("Missing Film engine");
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      reducedMotion: "no-preference",
    });
    try {
      const page = await context.newPage();
      await page.clock.install();
      await page.goto(fixture.url);
      const canvas = page.getByRole("img", {
        name: /Нужные файлы проекта копиями летят/,
      });
      await browserExpect
        .poll(() => canvas.evaluate(readCanvasWidth))
        .toBe(320);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const image = () => canvas.evaluate(readCanvasImage);
      const poster = await image();
      await page.getByRole("button", { name: "Toggle motion" }).click();
      await page.clock.runFor(1000);
      await browserExpect.poll(image).not.toBe(poster);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await browserExpect.poll(image).toBe(poster);
      await page.clock.runFor(1000);
      await browserExpect.poll(image).toBe(poster);
      await page.getByRole("button", { name: "Toggle motion" }).click();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.getByRole("button", { name: "Toggle motion" }).click();
      await page.clock.runFor(1000);
      await browserExpect.poll(image).not.toBe(poster);
    } finally {
      await context.close();
    }
  }, 30_000);

  test(`${name}: retained hiding and removal release the Canvas observers and frame clock`, async () => {
    const browser = fixture.browsers.get(name);
    if (browser === undefined) throw new Error("Missing Film engine");
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      reducedMotion: "no-preference",
    });
    try {
      const page = await context.newPage();
      await page.addInitScript(observeFilmResources);
      await page.goto(fixture.url);
      const canvas = page.locator("canvas");
      await browserExpect
        .poll(() => canvas.evaluate(readCanvasWidth))
        .toBe(320);
      await page.getByRole("button", { name: "Toggle motion" }).click();
      const resources = () =>
        page.evaluate(() => {
          if (window.courseFilmResourceSnapshot === undefined)
            throw new Error("Missing browser resource observation");
          return window.courseFilmResourceSnapshot();
        });
      await browserExpect.poll(resources).toEqual({
        resize: 1,
        intersection: 1,
        frames: 1,
        visibility: 1,
        media: 1,
      });
      const original = await canvas.elementHandle();
      await page.getByRole("button", { name: "Toggle visibility" }).click();
      await browserExpect.poll(resources).toEqual({
        resize: 0,
        intersection: 0,
        frames: 0,
        visibility: 0,
        media: 0,
      });
      await browserExpect
        .poll(() =>
          original.evaluate((element) => ({
            connected: element.isConnected,
            visible: element.getClientRects().length > 0,
          })),
        )
        .toEqual({ connected: true, visible: false });
      await page.getByRole("button", { name: "Toggle visibility" }).click();
      await browserExpect.poll(resources).toEqual({
        resize: 1,
        intersection: 1,
        frames: 1,
        visibility: 1,
        media: 1,
      });
      await browserExpect
        .poll(() =>
          canvas.evaluate((element, before) => element === before, original),
        )
        .toBe(true);
      await page.getByRole("button", { name: "Remove film" }).click();
      await browserExpect(canvas).toHaveCount(0);
      await browserExpect.poll(resources).toEqual({
        resize: 0,
        intersection: 0,
        frames: 0,
        visibility: 0,
        media: 0,
      });
    } finally {
      await context.close();
    }
  }, 30_000);

  test(`${name}: leaving the viewport pauses the frame clock and returning resumes it`, async () => {
    const browser = fixture.browsers.get(name);
    if (browser === undefined) throw new Error("Missing Film engine");
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      reducedMotion: "no-preference",
    });
    try {
      const page = await context.newPage();
      await page.clock.install();
      await page.addInitScript(observeFilmResources);
      await page.goto(fixture.url);
      const canvas = page.locator("canvas");
      await browserExpect
        .poll(() => canvas.evaluate(readCanvasWidth))
        .toBe(320);
      await page.getByRole("button", { name: "Toggle motion" }).click();
      const resources = () =>
        page.evaluate(() => window.courseFilmResourceSnapshot?.());
      await browserExpect.poll(resources).toEqual({
        resize: 1,
        intersection: 1,
        frames: 1,
        visibility: 1,
        media: 1,
      });
      await page.getByRole("button", { name: "Toggle offscreen" }).click();
      await browserExpect.poll(resources).toEqual({
        resize: 1,
        intersection: 1,
        frames: 0,
        visibility: 1,
        media: 1,
      });
      const paused = await canvas.evaluate(readCanvasImage);
      await page.clock.runFor(5000);
      await browserExpect
        .poll(() => canvas.evaluate(readCanvasImage))
        .toBe(paused);
      await page.getByRole("button", { name: "Toggle offscreen" }).click();
      await browserExpect.poll(resources).toEqual({
        resize: 1,
        intersection: 1,
        frames: 1,
        visibility: 1,
        media: 1,
      });
      await page.clock.runFor(1000);
      await browserExpect
        .poll(() => canvas.evaluate(readCanvasImage))
        .not.toBe(paused);
    } finally {
      await context.close();
    }
  }, 30_000);

  test(`${name}: the document visibility input pauses playback without releasing the visible Canvas`, async () => {
    const browser = fixture.browsers.get(name);
    if (browser === undefined) throw new Error("Missing Film engine");
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      reducedMotion: "no-preference",
    });
    try {
      const page = await context.newPage();
      await page.clock.install();
      await page.addInitScript(observeFilmResources);
      await page.goto(fixture.url);
      const canvas = page.locator("canvas");
      await browserExpect
        .poll(() => canvas.evaluate(readCanvasWidth))
        .toBe(320);
      await page.getByRole("button", { name: "Toggle motion" }).click();
      const resources = () =>
        page.evaluate(() => window.courseFilmResourceSnapshot?.());
      await browserExpect.poll(resources).toEqual({
        resize: 1,
        intersection: 1,
        frames: 1,
        visibility: 1,
        media: 1,
      });
      await page.clock.runFor(1000);
      // Headless engines expose visibility as an external browser input, not a second own-module adapter.
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await browserExpect.poll(resources).toEqual({
        resize: 1,
        intersection: 1,
        frames: 0,
        visibility: 1,
        media: 1,
      });
      const paused = await canvas.evaluate(readCanvasImage);
      await page.clock.runFor(5000);
      await browserExpect
        .poll(() => canvas.evaluate(readCanvasImage))
        .toBe(paused);
      await page.evaluate(() => {
        Reflect.deleteProperty(document, "hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await browserExpect.poll(resources).toEqual({
        resize: 1,
        intersection: 1,
        frames: 1,
        visibility: 1,
        media: 1,
      });
      await page.clock.runFor(1000);
      await browserExpect
        .poll(() => canvas.evaluate(readCanvasImage))
        .not.toBe(paused);
    } finally {
      await context.close();
    }
  }, 30_000);

  test(`${name}: hidden time is excluded from the resumed film timeline`, async () => {
    const browser = fixture.browsers.get(name);
    if (browser === undefined) throw new Error("Missing Film engine");
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      reducedMotion: "no-preference",
    });
    try {
      const page = await context.newPage();
      await page.clock.install({ time: new Date("2026-11-17T00:00:00Z") });
      await page.addInitScript(observeFilmResources);
      await page.goto(fixture.url);
      const canvas = page.locator("canvas");
      await browserExpect
        .poll(() => canvas.evaluate(readCanvasWidth))
        .toBe(320);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.clock.pauseAt(new Date("2026-11-17T00:00:10Z"));
      const resources = () =>
        page.evaluate(() => window.courseFilmResourceSnapshot?.());
      const active = {
        resize: 1,
        intersection: 1,
        frames: 1,
        visibility: 1,
        media: 1,
      };
      await page.getByRole("button", { name: "Toggle motion" }).click();
      await browserExpect.poll(resources).toEqual(active);
      await page.clock.runFor(2048);
      const continuous = await canvas.evaluate(readCanvasImage);
      await page.getByRole("button", { name: "Toggle motion" }).click();
      await browserExpect.poll(resources).toEqual({ ...active, frames: 0 });
      await page.getByRole("button", { name: "Toggle motion" }).click();
      await browserExpect.poll(resources).toEqual(active);
      await page.clock.runFor(1024);
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await browserExpect.poll(resources).toEqual({ ...active, frames: 0 });
      await page.clock.runFor(5120);
      await page.evaluate(() => {
        Reflect.deleteProperty(document, "hidden");
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await browserExpect.poll(resources).toEqual(active);
      await page.clock.runFor(1024);
      await browserExpect
        .poll(() => canvas.evaluate(readCanvasImage))
        .toBe(continuous);
    } finally {
      await context.close();
    }
  }, 30_000);

  test(`${name}: fonts completing after removal cannot paint or restart the old Canvas`, async () => {
    const browser = fixture.browsers.get(name);
    if (browser === undefined) throw new Error("Missing Film engine");
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      reducedMotion: "no-preference",
    });
    try {
      const page = await context.newPage();
      await page.addInitScript(observeFilmResources);
      await page.addInitScript(delayFilmFonts);
      await page.goto(fixture.url);
      const canvas = page.locator("canvas");
      await browserExpect
        .poll(() => canvas.evaluate(readCanvasWidth))
        .toBe(320);
      await page.getByRole("button", { name: "Toggle motion" }).click();
      const resources = () =>
        page.evaluate(() => {
          if (window.courseFilmResourceSnapshot === undefined)
            throw new Error("Missing browser resource observation");
          return window.courseFilmResourceSnapshot();
        });
      await browserExpect.poll(resources).toEqual({
        resize: 1,
        intersection: 1,
        frames: 0,
        visibility: 1,
        media: 1,
      });
      const original = await canvas.elementHandle();
      const poster = await original.evaluate(readCanvasImage);
      await page.getByRole("button", { name: "Remove film" }).click();
      await browserExpect.poll(resources).toEqual({
        resize: 0,
        intersection: 0,
        frames: 0,
        visibility: 0,
        media: 0,
      });
      await page.evaluate(async () => {
        if (window.courseFilmFontsGate === undefined)
          throw new Error("Missing external font completion");
        await window.courseFilmFontsGate.release();
      });
      await browserExpect.poll(resources).toEqual({
        resize: 0,
        intersection: 0,
        frames: 0,
        visibility: 0,
        media: 0,
      });
      await browserExpect
        .poll(() => original.evaluate(readCanvasImage))
        .toBe(poster);
    } finally {
      await context.close();
    }
  }, 30_000);
  for (const version of ["v1", "v2"] as const) {
    test(`${name}: the requested ${version} loads its actual module after the default poster`, async () => {
      const browser = fixture.browsers.get(name);
      if (browser === undefined) throw new Error("Missing Film engine");
      const context = await browser.newContext({
        viewport: { width: 800, height: 600 },
      });
      const hold = Promise.withResolvers<undefined>();
      const started = Promise.withResolvers<undefined>();
      try {
        const page = await context.newPage();
        const path = version === "v1" ? "course-film.ts" : "course-film-v2.ts";
        await page.route(
          `**/src/features/ai-engineering-course/model/${path}*`,
          async (route) => {
            const response = await route.fetch();
            started.resolve(undefined);
            await hold.promise;
            await route.fulfill({ response });
          },
        );
        await page.goto(`${fixture.url}?film=${version}`);
        await started.promise;
        const canvas = page.locator("canvas");
        await browserExpect(canvas).toHaveAccessibleName(
          /Нужные файлы проекта копиями летят/,
        );
        await browserExpect
          .poll(() => canvas.evaluate(readCanvasWidth))
          .toBe(320);
        const poster = await canvas.evaluate(readCanvasImage);
        hold.resolve(undefined);
        await browserExpect(canvas).toHaveAccessibleName(
          version === "v1" ? /одним непрерывным движением/ : /путь одной фичи/,
        );
        await browserExpect
          .poll(() => canvas.evaluate(readCanvasImage))
          .not.toBe(poster);
      } finally {
        hold.resolve(undefined);
        await context.close();
      }
    }, 30_000);
  }

  test(`${name}: an alternative module completing after removal cannot paint or acquire resources`, async () => {
    const browser = fixture.browsers.get(name);
    if (browser === undefined) throw new Error("Missing Film engine");
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
    });
    const hold = Promise.withResolvers<undefined>();
    const started = Promise.withResolvers<undefined>();
    let moduleUrl = "";
    try {
      const page = await context.newPage();
      await page.addInitScript(observeFilmResources);
      await page.route(
        "**/src/features/ai-engineering-course/model/course-film.ts*",
        async (route) => {
          moduleUrl = route.request().url();
          const response = await route.fetch();
          started.resolve(undefined);
          await hold.promise;
          await route.fulfill({ response });
        },
      );
      await page.goto(`${fixture.url}?film=v1`);
      await started.promise;
      const canvas = page.locator("canvas");
      await browserExpect(canvas).toHaveAccessibleName(
        /Нужные файлы проекта копиями летят/,
      );
      await browserExpect
        .poll(() => canvas.evaluate(readCanvasWidth))
        .toBe(320);
      const original = await canvas.elementHandle();
      const poster = await original.evaluate(readCanvasImage);
      await page.getByRole("button", { name: "Remove film" }).click();
      hold.resolve(undefined);
      // Join the actual native ESM request; no own module is replaced or synthesized.
      const loaded = await page.evaluate(
        `import(${JSON.stringify(moduleUrl)}).then(() => true)`,
      );
      browserExpect(loaded).toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            const checkpoint = new MessageChannel();
            checkpoint.port1.onmessage = () => {
              checkpoint.port1.close();
              checkpoint.port2.close();
              resolve();
            };
            checkpoint.port2.postMessage(null);
          }),
      );
      await browserExpect
        .poll(() => page.evaluate(() => window.courseFilmResourceSnapshot?.()))
        .toEqual({
          resize: 0,
          intersection: 0,
          frames: 0,
          visibility: 0,
          media: 0,
        });
      await browserExpect
        .poll(() => original.evaluate(readCanvasImage))
        .toBe(poster);
    } finally {
      hold.resolve(undefined);
      await context.close();
    }
  }, 30_000);
  test(`${name}: a failed alternative remains a stationary default poster even with autoplay requested`, async () => {
    const browser = fixture.browsers.get(name);
    if (browser === undefined) throw new Error("Missing Film engine");
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      reducedMotion: "no-preference",
    });
    try {
      const page = await context.newPage();
      await page.clock.install();
      await page.addInitScript(observeFilmResources);
      let moduleUrl = "";
      await page.route(
        "**/src/features/ai-engineering-course/model/course-film.ts*",
        async (route) => {
          moduleUrl = route.request().url();
          await route.abort("failed");
        },
      );
      const failed = page.waitForEvent("requestfailed", {
        predicate: (request) => request.url().includes("/model/course-film.ts"),
      });
      await page.goto(`${fixture.url}?film=v1`);
      await failed;
      const rejected = await page.evaluate(
        `import(${JSON.stringify(moduleUrl)}).then(() => false, () => true)`,
      );
      browserExpect(rejected).toBe(true);
      const canvas = page.getByRole("img", {
        name: /Нужные файлы проекта копиями летят/,
      });
      await browserExpect
        .poll(() => canvas.evaluate(readCanvasWidth))
        .toBe(320);
      const poster = await canvas.evaluate(readCanvasImage);
      await page.getByRole("button", { name: "Toggle motion" }).click();
      await browserExpect
        .poll(() => page.evaluate(() => window.courseFilmResourceSnapshot?.()))
        .toEqual({
          resize: 1,
          intersection: 1,
          frames: 0,
          visibility: 1,
          media: 1,
        });
      await page.clock.runFor(1000);
      await browserExpect
        .poll(() => canvas.evaluate(readCanvasImage))
        .toBe(poster);
    } finally {
      await context.close();
    }
  }, 30_000);
}
