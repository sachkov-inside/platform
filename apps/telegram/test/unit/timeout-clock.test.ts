import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { fixedTestInstant, useTimeoutClock } from "../support/fixed-clock.js";

describe.each([
  { mode: "fixed", shouldAdvanceTime: false },
  { mode: "advancing", shouldAdvanceTime: true },
])("timeout clock with $mode Date", ({ shouldAdvanceTime }) => {
  beforeEach(() => {
    vi.useFakeTimers({
      now: fixedTestInstant(),
      shouldAdvanceTime,
      toFake: ["Date"],
    });
  });

  afterEach(() => vi.useRealTimers());

  test("keeps the registered Date while virtual timeout timers advance", async () => {
    const restoreDate = useTimeoutClock({ shouldAdvanceTime });
    // deterministic-test-allow wall-clock: beforeEach registers fake Date at fixedTestInstant; timeout phases must preserve that clock.
    expect(Date.now()).toBe(fixedTestInstant());
    const fired = vi.fn();
    // deterministic-test-allow duration-wait: This timeout verifies the virtual timer port; advanceTimersByTimeAsync triggers it without a real pause.
    setTimeout(fired, 100);
    await vi.advanceTimersByTimeAsync(100);
    expect(fired).toHaveBeenCalledOnce();
    // deterministic-test-allow wall-clock: Date remains on the registered virtual clock after explicit timer advancement.
    const instant = Date.now();
    expect(instant).toBeGreaterThanOrEqual(fixedTestInstant() + 100);
    restoreDate();
    // deterministic-test-allow wall-clock: Restoring native timeout methods must retain the current virtual Date, without rollback.
    expect(Date.now()).toBe(instant);
  });

  test("restores native timeout methods while retaining virtual Date", () => {
    const restoreDate = useTimeoutClock({ shouldAdvanceTime });
    restoreDate();
    // deterministic-test-allow wall-clock: The restore operation keeps beforeEach's registered fake Date instead of the machine calendar.
    expect(Date.now()).toBe(fixedTestInstant());
    // deterministic-test-allow duration-wait: This native timer is cleared immediately; its absence from the virtual queue proves timer restoration without waiting.
    const timer = setTimeout(vi.fn(), 1000);
    try {
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      clearTimeout(timer);
    }
    restoreDate();
    // deterministic-test-allow wall-clock: Repeated restoration preserves the registered virtual Date too.
    expect(Date.now()).toBe(fixedTestInstant());
  });
});
