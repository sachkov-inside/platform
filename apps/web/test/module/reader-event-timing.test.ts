import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installReaderEventTimingDiagnostic,
  readerEventTimingSchema,
} from "../support/reader-event-timing";

// The boundary is the browser observer. No application runtime or DOM contents are recorded.
describe("Reader Event Timing diagnostic", () => {
  afterEach(() => vi.unstubAllGlobals());

  function browser() {
    const events = new EventTarget();
    let deliver: ((list: { getEntries(): unknown[] }) => void) | undefined;
    const queued: unknown[] = [];
    vi.stubGlobal("window", events);
    class SyntheticElement {
      constructor(private readonly selectors: string[]) {}
      closest(selector: string) {
        return this.selectors.includes(selector) ? this : null;
      }
    }
    vi.stubGlobal("Element", SyntheticElement);
    vi.stubGlobal(
      "PerformanceObserver",
      class {
        static supportedEntryTypes = ["event"];
        constructor(callback: typeof deliver) {
          deliver = callback;
        }
        observe() {
          // Delivery is controlled at the browser-observer boundary.
        }
        takeRecords() {
          return queued.splice(0);
        }
      },
    );
    installReaderEventTimingDiagnostic();
    return {
      element: (selectors: string[]) => new SyntheticElement(selectors),
      flush: () =>
        events.dispatchEvent(new Event("inside:take-performance-records")),
      emit: (entries: unknown[]) => deliver?.({ getEntries: () => entries }),
      queue: (entry: unknown) => queued.push(entry),
      checkpoint: (phase: "before" | "after") =>
        events.dispatchEvent(
          new Event(`inside:reader-event-timing-${phase}-axe`),
        ),
      read: () =>
        readerEventTimingSchema.parse(
          Reflect.get(events, "__readerEventTimingDiagnostic"),
        ),
    };
  }

  it("keeps bounded, finite diagnostic data and the slowest late event beyond the row limit", () => {
    const subject = browser();
    subject.emit(
      Array.from({ length: 40 }, () => ({
        name: "private DOM content",
        duration: 16,
        startTime: 10,
      })),
    );
    subject.checkpoint("before");
    subject.queue({
      name: "keydown",
      duration: 224,
      startTime: 20,
      processingStart: 25,
      processingEnd: 120,
      target: null,
      interactionId: 42,
      private: "secret",
    });
    subject.checkpoint("after");
    const result = subject.read();
    expect(result.rows).toHaveLength(32);
    expect(result.count).toBe(41);
    expect(result.saturated).toBe(true);
    expect(result.maximum).toMatchObject({
      name: "keydown",
      duration: 224,
      target: "unknown",
      deliveredPhase: "during_axe",
    });
    expect(result.beforeAxe).toMatchObject({ count: 40, maxDuration: 16 });
    expect(result.afterAxe).toMatchObject({ count: 41, maxDuration: 224 });
    expect(JSON.stringify(result)).not.toMatch(
      /private DOM|secret|interactionId/,
    );
  });

  it("projects DOM targets into a fixed enum and keeps post-axe queued events", () => {
    const subject = browser();
    subject.emit([
      {
        name: "click",
        duration: 16,
        startTime: 1,
        target: subject.element(['a[href="#app:content"]']),
      },
    ]);
    subject.checkpoint("before");
    subject.checkpoint("after");
    subject.queue({
      name: "keyup",
      duration: 232,
      startTime: 2,
      target: subject.element(["[data-reader-body]", "main"]),
    });
    subject.flush();
    const result = subject.read();
    expect(result.rows.map((row) => row.target)).toEqual([
      "skip_link",
      "reader_body",
    ]);
    expect(result.maximum).toMatchObject({
      duration: 232,
      deliveredPhase: "after_axe",
    });
    expect(result.beforeAxe?.maxDuration).toBe(16);
    expect(result.afterAxe?.maxDuration).toBe(16);
    expect(JSON.stringify(result)).not.toMatch(
      /href|app:content|data-reader-body|selector/,
    );
  });

  it("clamps invalid numbers and keeps observation counts finite", () => {
    const subject = browser();
    subject.emit(
      Array.from({ length: 4100 }, () => ({
        name: "click",
        duration: Infinity,
        startTime: -20,
        processingStart: NaN,
        processingEnd: 99999999999,
      })),
    );
    const result = subject.read();
    expect(result.count).toBe(4096);
    expect(result.saturated).toBe(true);
    subject.emit([{ name: "keyup", duration: 500, startTime: 20 }]);
    expect(subject.read().maximum?.duration).toBe(500);
    expect(subject.read().count).toBe(4096);
    expect(result.rows[0]).toMatchObject({
      duration: 0,
      startTime: 0,
      processingStart: 0,
      processingEnd: 3600000,
    });
  });
});
