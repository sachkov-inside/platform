import { afterEach, describe, expect, it, vi } from "vitest";

import {
  keepShellScrollAcrossBreakpoint,
  readShellScroll,
  resetShellScroll,
  readShellScrollRoots,
  restoreShellScroll,
  scrollShellRootsTo,
  subscribeShellBreakpoint,
} from "@/shared/lib/shell-scroll";

type Listener = (event: { readonly target: unknown }) => void;

class FakeTarget {
  private readonly listeners: {
    type: string;
    listener: Listener;
    capture: boolean;
  }[] = [];
  addEventListener(
    type: string,
    listener: Listener,
    options?: boolean | { readonly capture?: boolean },
  ) {
    const capture =
      typeof options === "boolean" ? options : options?.capture === true;
    this.listeners.push({ type, listener, capture });
  }
  removeEventListener(
    type: string,
    listener: Listener,
    options?: boolean | { readonly capture?: boolean },
  ) {
    const capture =
      typeof options === "boolean" ? options : options?.capture === true;
    const index = this.listeners.findIndex(
      (entry) =>
        entry.type === type &&
        entry.listener === listener &&
        entry.capture === capture,
    );
    if (index >= 0) this.listeners.splice(index, 1);
  }
  emit(type: string, target: unknown, phase: "capture" | "target" | "bubble") {
    for (const entry of [...this.listeners])
      if (
        entry.type === type &&
        (phase === "target" || entry.capture === (phase === "capture"))
      )
        entry.listener({ target });
  }
  listenerCount() {
    return this.listeners.length;
  }
}

class FakeScroller extends FakeTarget {
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  readonly firstElementChild = {};
  constructor(private readonly scrolled: (scroller: FakeScroller) => void) {
    super();
  }
  scrollTo({ top }: { readonly top: number }) {
    this.setTop(top);
  }
  setTop(top: number) {
    const next = Math.max(
      0,
      Math.min(top, this.scrollHeight - this.clientHeight),
    );
    if (next === this.scrollTop) return;
    this.scrollTop = next;
    this.scrolled(this);
  }
}

/**
 * The public shell as the browser lays it out: below 64rem the document scrolls and the content
 * element grows with the page; from 64rem the document is one viewport tall and the content
 * element scrolls. Layout clamps the previous scroll owner before the media query reports the
 * change, as browsers do.
 */
function publicShell({
  width,
  pageHeight = 3_000,
  withContent = true,
}: {
  readonly width: number;
  readonly pageHeight?: number;
  readonly withContent?: boolean;
}) {
  const viewportHeight = 800;
  const shell = { width, pageHeight };
  const fakeWindow = new FakeTarget();
  const fakeDocument = new FakeTarget();
  const scrolled = (scroller: FakeScroller) => {
    if (scroller === root) {
      fakeDocument.emit("scroll", fakeDocument, "target");
      fakeWindow.emit("scroll", fakeDocument, "bubble");
    } else {
      fakeDocument.emit("scroll", scroller, "capture");
      scroller.emit("scroll", scroller, "target");
    }
  };
  const root = new FakeScroller(scrolled);
  const content = new FakeScroller(scrolled);
  const media: {
    query: string;
    minimum: number;
    listeners: Set<() => void>;
  }[] = [];
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { at: number; run: () => void }>();
  const observers = new Set<{ targets: Set<object>; callback: () => void }>();
  let nextHandle = 1;
  let now = 0;

  const layout = () => {
    if (shell.width >= 1_024) {
      root.scrollHeight = viewportHeight;
      root.clientHeight = viewportHeight;
      content.scrollHeight = shell.pageHeight;
      content.clientHeight = viewportHeight - 80;
    } else {
      root.scrollHeight = shell.pageHeight + 56;
      root.clientHeight = viewportHeight;
      content.scrollHeight = shell.pageHeight;
      content.clientHeight = shell.pageHeight;
    }
    root.setTop(root.scrollTop);
    content.setTop(content.scrollTop);
  };
  layout();

  defineMembers(fakeWindow, {
    get scrollY() {
      return root.scrollTop;
    },
    scrollTo: ({ top }: { readonly top: number }) => {
      root.scrollTo({ top });
    },
    matchMedia(query: string) {
      const match = /^\((?:width >= |min-width: )(\d+(?:\.\d+)?)rem\)$/u.exec(
        query,
      );
      if (match?.[1] === undefined)
        throw new Error(`Unsupported media query ${query}`);
      const entry = {
        query,
        minimum: Number(match[1]) * 16,
        listeners: new Set<() => void>(),
      };
      media.push(entry);
      return {
        get matches() {
          return shell.width >= entry.minimum;
        },
        addEventListener: (_type: "change", listener: () => void) => {
          entry.listeners.add(listener);
        },
        removeEventListener: (_type: "change", listener: () => void) => {
          entry.listeners.delete(listener);
        },
      };
    },
    requestAnimationFrame(run: () => void) {
      const handle = nextHandle++;
      frames.set(handle, run);
      return handle;
    },
    cancelAnimationFrame(handle: number) {
      frames.delete(handle);
    },
    setTimeout(run: () => void, delay: number) {
      const handle = nextHandle++;
      timers.set(handle, { at: now + delay, run });
      return handle;
    },
    clearTimeout(handle: number) {
      timers.delete(handle);
    },
  });
  defineMembers(fakeDocument, {
    documentElement: root,
    querySelector: (selector: string) =>
      withContent && selector === "[data-application-content]" ? content : null,
  });
  // Fake scroll roots are not DOM elements; only a real Element scope searches its ancestors.
  vi.stubGlobal(
    "Element",
    class FakeElement {
      readonly real = false;
    },
  );
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly entry: { targets: Set<object>; callback: () => void };
      constructor(callback: () => void) {
        this.entry = { targets: new Set(), callback };
        observers.add(this.entry);
      }
      observe(target: object) {
        this.entry.targets.add(target);
      }
      disconnect() {
        observers.delete(this.entry);
      }
    },
  );

  return {
    get documentTop() {
      return root.scrollTop;
    },
    get contentTop() {
      return content.scrollTop;
    },
    /** A user or the browser scrolls whatever currently scrolls in this layout. */
    scrollDocument(top: number) {
      root.setTop(top);
    },
    scrollContent(top: number) {
      content.setTop(top);
    },
    /** `beforeMediaEvent` runs after the new layout and before the media query reports it. */
    resize(next: number, beforeMediaEvent?: () => void) {
      const before = media.map((entry) => shell.width >= entry.minimum);
      shell.width = next;
      layout();
      beforeMediaEvent?.();
      media.forEach((entry, index) => {
        if (before[index] !== shell.width >= entry.minimum)
          entry.listeners.forEach((listener) => {
            listener();
          });
      });
    },
    /** Streamed content arrives: the page grows and the content element reports its resize. */
    growPage(height: number) {
      shell.pageHeight = height;
      layout();
      for (const observer of [...observers])
        if (
          observer.targets.has(content) ||
          observer.targets.has(content.firstElementChild)
        )
          observer.callback();
    },
    frame() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((run) => {
        run();
      });
    },
    elapse(ms: number) {
      now += ms;
      for (const [handle, timer] of [...timers])
        if (timer.at <= now) {
          timers.delete(handle);
          timer.run();
        }
    },
    userInput(type: "keydown" | "popstate" | "touchstart" | "wheel") {
      fakeWindow.emit(type, fakeWindow, "target");
    },
    listenerCount() {
      return (
        fakeWindow.listenerCount() +
        fakeDocument.listenerCount() +
        content.listenerCount() +
        media.reduce((sum, entry) => sum + entry.listeners.size, 0) +
        observers.size +
        frames.size +
        timers.size
      );
    },
  };
}

/** Copies accessors as accessors: the fake window reads its scroll position live. */
function defineMembers(target: object, members: object) {
  Object.defineProperties(target, Object.getOwnPropertyDescriptors(members));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shell scroll position", () => {
  it("reads the document below 64rem", () => {
    const shell = publicShell({ width: 1_023 });
    shell.scrollDocument(640);
    expect(readShellScroll()).toBe(640);
  });

  it("reads the shell content from 64rem", () => {
    const shell = publicShell({ width: 1_024 });
    shell.scrollContent(640);
    expect(readShellScroll()).toBe(640);
  });

  it("leaves a page without shell content alone", () => {
    const shell = publicShell({ width: 1_440, withContent: false });
    expect(readShellScroll()).toBe(0);
    expect(readShellScrollRoots()).toEqual({ windowY: 0, contentY: 0 });
    scrollShellRootsTo({ windowY: 300, contentY: 300 });
    resetShellScroll();
    keepShellScrollAcrossBreakpoint()();
    restoreShellScroll(300, 3_000)();
    expect(shell.documentTop).toBe(0);
    expect(shell.listenerCount()).toBe(0);
  });

  it("returns both scroll roots to the top", () => {
    const shell = publicShell({ width: 1_440 });
    shell.scrollContent(900);
    resetShellScroll();
    expect(shell.contentTop).toBe(0);
    shell.resize(390);
    shell.scrollDocument(900);
    resetShellScroll();
    expect(shell.documentTop).toBe(0);
  });
});

describe("shell scroll roots saved together", () => {
  it("restores each root as it was saved at the same width", () => {
    const desktop = publicShell({ width: 1_440 });
    desktop.scrollContent(600);
    const saved = readShellScrollRoots();
    expect(saved).toEqual({ windowY: 0, contentY: 600 });
    desktop.scrollContent(0);
    scrollShellRootsTo(saved);
    expect(desktop.contentTop).toBe(600);
    expect(desktop.documentTop).toBe(0);

    const phone = publicShell({ width: 390 });
    phone.scrollDocument(450);
    const savedOnPhone = readShellScrollRoots();
    expect(savedOnPhone).toEqual({ windowY: 450, contentY: 0 });
    phone.scrollDocument(0);
    scrollShellRootsTo(savedOnPhone);
    expect(phone.documentTop).toBe(450);
  });

  it("writes each root separately after a width change, as the browser clamps it", () => {
    const shell = publicShell({ width: 1_440 });
    shell.scrollContent(600);
    const saved = readShellScrollRoots();
    shell.resize(390);
    shell.scrollDocument(0);
    scrollShellRootsTo(saved);
    // The phone layout does not scroll the content, so the saved content position is dropped.
    expect(shell.documentTop).toBe(0);
    expect(shell.contentTop).toBe(0);
  });
});

describe("shell breakpoint subscription", () => {
  it("reports the desktop breakpoint changes until unsubscribed", () => {
    const shell = publicShell({ width: 1_023 });
    const changes: boolean[] = [];
    const unsubscribe = subscribeShellBreakpoint((desktop) => {
      changes.push(desktop);
    });
    shell.resize(1_024);
    shell.resize(1_000);
    unsubscribe();
    shell.resize(1_440);
    expect(changes).toEqual([true, false]);
    expect(shell.listenerCount()).toBe(0);
  });
});

describe("shell scroll across the breakpoint", () => {
  it("moves the reading position from the document to the content and back", () => {
    const shell = publicShell({ width: 390 });
    const stop = keepShellScrollAcrossBreakpoint();
    shell.scrollDocument(700);
    shell.resize(1_440);
    expect(shell.contentTop).toBe(700);
    expect(shell.documentTop).toBe(0);
    shell.scrollContent(450);
    shell.resize(390);
    expect(shell.documentTop).toBe(450);
    expect(shell.contentTop).toBe(0);
    stop();
    expect(shell.listenerCount()).toBe(0);
  });

  it("keeps a scroll in the new owner that precedes the breakpoint event", () => {
    const shell = publicShell({ width: 390 });
    keepShellScrollAcrossBreakpoint();
    shell.scrollDocument(700);
    shell.resize(1_440, () => {
      shell.scrollContent(260);
    });
    expect(shell.contentTop).toBe(260);
    expect(shell.documentTop).toBe(0);
    shell.resize(390, () => {
      shell.scrollDocument(90);
    });
    expect(shell.documentTop).toBe(90);
    expect(shell.contentTop).toBe(0);
  });
});

describe("shell scroll restoration", () => {
  it("waits until the page is tall enough, then writes the position once", () => {
    const shell = publicShell({ width: 1_440, pageHeight: 900 });
    restoreShellScroll(1_600, 3_000);
    shell.frame();
    expect(shell.contentTop).toBe(0);
    shell.growPage(4_000);
    shell.frame();
    expect(shell.contentTop).toBe(1_600);
    shell.scrollContent(100);
    shell.growPage(6_000);
    shell.frame();
    expect(shell.contentTop).toBe(100);
    expect(shell.listenerCount()).toBe(0);
  });

  it("restores the document position on a phone", () => {
    const shell = publicShell({ width: 390, pageHeight: 3_000 });
    restoreShellScroll(1_200, 3_000);
    shell.frame();
    expect(shell.documentTop).toBe(1_200);
  });

  it.each(["keydown", "popstate", "touchstart", "wheel"] as const)(
    "gives up when the reader takes over with %s",
    (input) => {
      const shell = publicShell({ width: 390, pageHeight: 900 });
      restoreShellScroll(1_600, 3_000);
      shell.userInput(input);
      shell.growPage(4_000);
      shell.frame();
      expect(shell.documentTop).toBe(0);
      expect(shell.listenerCount()).toBe(0);
    },
  );

  it("gives up after its timeout or when stopped", () => {
    const timedOut = publicShell({ width: 390, pageHeight: 900 });
    restoreShellScroll(1_600, 3_000);
    timedOut.elapse(3_000);
    timedOut.growPage(4_000);
    timedOut.frame();
    expect(timedOut.documentTop).toBe(0);
    expect(timedOut.listenerCount()).toBe(0);

    const stopped = publicShell({ width: 390, pageHeight: 900 });
    const stop = restoreShellScroll(1_600, 3_000);
    stop();
    stopped.growPage(4_000);
    stopped.frame();
    expect(stopped.documentTop).toBe(0);
    expect(stopped.listenerCount()).toBe(0);
  });
});
