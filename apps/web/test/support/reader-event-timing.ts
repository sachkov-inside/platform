import { z } from "zod";

const boundedTime = z.number().min(0).max(3_600_000);
const rowSchema = z.strictObject({
  name: z.enum([
    "keydown",
    "keyup",
    "keypress",
    "click",
    "pointerdown",
    "pointerup",
    "pointercancel",
    "mousedown",
    "mouseup",
    "touchstart",
    "touchend",
    "touchcancel",
    "other",
  ]),
  target: z.enum(["skip_link", "reader_body", "main", "other", "unknown"]),
  deliveredPhase: z.enum(["before_axe", "during_axe", "after_axe"]),
  startTime: boundedTime,
  duration: z.number().min(0).max(60_000),
  processingStart: boundedTime,
  processingEnd: boundedTime,
});
const checkpointSchema = z.strictObject({
  at: boundedTime,
  count: z.int().min(0).max(4096),
  maxDuration: z.number().min(0).max(60_000),
});
export const readerEventTimingSchema = z.strictObject({
  supported: z.boolean(),
  count: z.int().min(0).max(4096),
  saturated: z.boolean(),
  rows: z.array(rowSchema).max(32),
  maximum: rowSchema.nullable(),
  beforeAxe: checkpointSchema.nullable(),
  afterAxe: checkpointSchema.nullable(),
});

/** Self-contained because Playwright serializes this function into the page. */
export function installReaderEventTimingDiagnostic() {
  const state: z.infer<typeof readerEventTimingSchema> = {
    supported: false,
    count: 0,
    saturated: false,
    rows: [],
    maximum: null,
    beforeAxe: null,
    afterAxe: null,
  };
  Object.defineProperty(window, "__readerEventTimingDiagnostic", {
    value: state,
  });
  state.supported = PerformanceObserver.supportedEntryTypes.includes("event");
  if (!state.supported) return;
  let deliveredPhase: z.infer<typeof rowSchema>["deliveredPhase"] =
    "before_axe";
  const bounded = (value: unknown, maximum: number) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      state.saturated = true;
      return 0;
    }
    const result = Math.min(maximum, Math.max(0, value));
    if (result !== value) state.saturated = true;
    return result;
  };
  const record = (entries: PerformanceEntryList) => {
    for (const entry of entries) {
      if (state.count < 4096) state.count += 1;
      else state.saturated = true;
      const names = [
        "keydown",
        "keyup",
        "keypress",
        "click",
        "pointerdown",
        "pointerup",
        "pointercancel",
        "mousedown",
        "mouseup",
        "touchstart",
        "touchend",
        "touchcancel",
      ] as const;
      const name = names.find((name) => name === entry.name) ?? "other";
      const target = "target" in entry ? entry.target : undefined;
      const targetKind = !(target instanceof Element)
        ? "unknown"
        : target.closest('a[href="#app:content"]')
          ? "skip_link"
          : target.closest("[data-reader-body]")
            ? "reader_body"
            : target.closest("main")
              ? "main"
              : "other";
      const row = {
        name,
        target: targetKind,
        deliveredPhase,
        startTime: bounded(entry.startTime, 3_600_000),
        duration: bounded(entry.duration, 60_000),
        processingStart: bounded(
          "processingStart" in entry ? entry.processingStart : 0,
          3_600_000,
        ),
        processingEnd: bounded(
          "processingEnd" in entry ? entry.processingEnd : 0,
          3_600_000,
        ),
      } satisfies z.infer<typeof rowSchema>;
      if (state.rows.length < 32) state.rows.push(row);
      else state.saturated = true;
      if (state.maximum === null || row.duration > state.maximum.duration)
        state.maximum = row;
    }
  };
  const observer = new PerformanceObserver((list) => {
    record(list.getEntries());
  });
  observer.observe({
    type: "event",
    buffered: true,
    durationThreshold: 16,
  } as PerformanceObserverInit);
  window.addEventListener("inside:take-performance-records", () => {
    record(observer.takeRecords());
  });
  const checkpoint = () => {
    record(observer.takeRecords());
    return {
      at: bounded(performance.now(), 3_600_000),
      count: state.count,
      maxDuration: state.maximum?.duration ?? 0,
    };
  };
  window.addEventListener(
    "inside:reader-event-timing-before-axe",
    () => {
      state.beforeAxe = checkpoint();
      deliveredPhase = "during_axe";
    },
    { once: true },
  );
  window.addEventListener(
    "inside:reader-event-timing-after-axe",
    () => {
      state.afterAxe = checkpoint();
      deliveredPhase = "after_axe";
    },
    { once: true },
  );
}
