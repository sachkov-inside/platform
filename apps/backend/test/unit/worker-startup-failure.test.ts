import { afterEach, describe, expect, it, vi } from "vitest";

import { reportProcessFailure } from "../../src/infrastructure/observability/index.js";

describe("when an open connection outlives the failure", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("still exits with code 1 after a short grace period", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`);
    });

    reportProcessFailure(
      "video-deletions-worker",
      new Error("connect ECONNREFUSED 127.0.0.1:5432"),
    );

    expect(process.exitCode).toBe(1);
    expect(exit).not.toHaveBeenCalled();
    expect(() => vi.advanceTimersByTime(5_000)).toThrow("process.exit(1)");
  });
});
