import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { z } from "zod";

/** A repeatable domain instant; an integration run can exercise the other side of a calendar boundary. */
export function fixedTestInstant(): number {
  return Date.parse(
    z.iso
      .datetime()
      .parse(process.env["TEST_CLOCK_INSTANT"] ?? "2026-10-07T09:00:00Z"),
  );
}

/** Only Date is virtual: I/O, monotonic budgets and timer-driven workers keep real time. */
export function registerFixedClock(): void {
  const instant = fixedTestInstant();
  const reset = () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(instant);
  };
  beforeAll(reset);
  beforeEach(reset);
  afterEach(() => vi.useRealTimers());
  afterAll(() => vi.useRealTimers());
}
