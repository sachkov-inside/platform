import { mkdir, writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";

export type FirstTextAssertion = "scene" | "resources" | "first-text";

type Trace = ReturnType<typeof createFirstTextTrace>;

declare global {
  interface Window {
    artworkFirstText?: Trace;
  }
}

// Passed to addInitScript. All runtime dependencies must live in this function.
export function createFirstTextTrace() {
  let stage: Element | null = null;
  let typer: Element | null = null;
  let mutations: MutationObserver | undefined;
  const expected = "Добавь уведомления о новых заявках";
  const snapshot = () => {
    const value = typer?.textContent;
    const scene = stage?.getAttribute("data-scene") ?? "";
    return {
      ms: performance.now(),
      hidden: document.hidden,
      visibility: document.visibilityState,
      scene: /^[1-5]$/u.test(scene) ? Number(scene) : null,
      paused: stage?.classList.contains("is-paused") ?? null,
      text:
        value === undefined
          ? null
          : expected.startsWith(value)
            ? value
            : "[other]",
      length: value?.length ?? null,
    };
  };
  type Event = ReturnType<typeof snapshot> & { event: string };
  const events: Event[] = [];
  let dropped = 0;
  const record = (event: string) => {
    if (events.length === 32) {
      events.splice(16, 1);
      dropped++;
    }
    events.push({ event, ...snapshot() });
  };
  const visibility = () => {
    record("visibility");
  };
  window.addEventListener("visibilitychange", visibility, true);
  let firstRequest: number | null = null;
  let firstFrame: number | null = null;
  let lastFrame: number | null = null;
  let largestGap = 0;
  let delivered = 0;
  interface FrameRequest {
    ordinal: number;
    attemptedAt: number;
    fromFirstTick: boolean;
    handle: number | null;
    callbackEnteredAt: number | null;
    cancelledAt: number | null;
  }
  const firstTwoRequests: FrameRequest[] = [];
  const trace = {
    observe(host: Element) {
      stage = host.querySelector(".stage");
      typer = stage?.querySelector(".scene-1 .type") ?? null;
      record("observe");
      mutations?.disconnect();
      mutations = new MutationObserver(() => {
        record("stage-or-text");
      });
      if (stage)
        mutations.observe(stage, { attributeFilter: ["class", "data-scene"] });
      if (typer)
        mutations.observe(typer, {
          childList: true,
          characterData: true,
          subtree: true,
        });
    },
    intersection(intersecting: boolean) {
      record(intersecting ? "enter" : "exit");
    },
    request(fromFirstTick: boolean) {
      if (firstTwoRequests.length === 2) return;
      const attemptedAt = performance.now();
      firstRequest ??= attemptedAt;
      const slot: FrameRequest = {
        ordinal: firstTwoRequests.length + 1,
        attemptedAt,
        fromFirstTick,
        handle: null,
        callbackEnteredAt: null,
        cancelledAt: null,
      };
      firstTwoRequests.push(slot);
      return slot;
    },
    cancel(handle: number) {
      const pending = firstTwoRequests.find(
        (slot) =>
          slot.handle === handle &&
          slot.callbackEnteredAt === null &&
          slot.cancelledAt === null,
      );
      if (pending) pending.cancelledAt = performance.now();
    },
    frame(time: number) {
      delivered++;
      firstFrame ??= time;
      if (lastFrame !== null)
        largestGap = Math.max(largestGap, time - lastFrame);
      lastFrame = time;
    },
    snapshot: () => ({
      events,
      dropped,
      firstRequest,
      firstFrame,
      lastFrame,
      largestGap,
      delivered,
      frameRequests: {
        firstTwo: firstTwoRequests,
        observedThrough: "failure-snapshot",
        afterSnapshot: "unknown",
      },
      last: snapshot(),
    }),
    stop() {
      mutations?.disconnect();
      window.removeEventListener("visibilitychange", visibility, true);
      delete window.artworkFirstText;
    },
  };
  window.artworkFirstText = trace;
  return trace;
}

export async function saveFirstTextFailure(
  page: Page,
  assertion: FirstTextAssertion,
) {
  const trace = await page
    .evaluate(() => ({
      clock: window.artworkFirstText?.snapshot() ?? null,
      resources: window.processArtworkResources?.() ?? null,
    }))
    .catch(() => null);
  const directory = new URL(
    "../../test-results/browser-engines/process-artwork/",
    import.meta.url,
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    new URL("webkit-first-text.json", directory),
    JSON.stringify({ phase: "before-hide", assertion, ...trace }),
  );
  console.warn("[process-artwork] before Hide", {
    assertion,
    delivered: trace?.clock?.delivered ?? null,
    scene: trace?.clock?.last.scene ?? null,
    textLength: trace?.clock?.last.length ?? null,
  });
}
