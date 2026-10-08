import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { z } from "zod";

export function fixedTestInstant(): number {
  return Date.parse(
    z.iso
      .datetime()
      .parse(process.env["TEST_CLOCK_INSTANT"] ?? "2026-10-07T09:00:00Z"),
  );
}

/** In-process producers and consumers share Date; I/O and worker timers stay real. */
export function registerFixedClock(): void {
  registerDateClock(false);
}

/** Real worker-rate contracts share virtual Date while native elapsed time advances it. */
export function registerRuntimeClock(): void {
  registerDateClock(true);
}

function registerDateClock(shouldAdvanceTime: boolean): void {
  const instant = fixedTestInstant();
  const reset = () => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime });
    vi.setSystemTime(instant);
  };
  beforeAll(reset);
  beforeEach(reset);
  afterEach(() => vi.useRealTimers());
  afterAll(() => vi.useRealTimers());
}

/** Real transport-rate contracts advance from a fixed calendar anchor using monotonic elapsed time. */
export function runtimeTestClock(): { now(): Date } {
  const instant = fixedTestInstant();
  const started = performance.now();
  return { now: () => new Date(instant + performance.now() - started) };
}
