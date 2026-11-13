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

describe("when PostgreSQL closes the connection because it is being stopped", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("logs a planned stop without operator attention and still exits with code 1", () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const capture = (...parts: unknown[]) => {
      lines.push(parts.map(String).join(" "));
    };
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(console, "warn").mockImplementation(capture);
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${String(code)})`);
    });
    // Server reboot 2026-11-13: pg reports the shutdown as 57P01 on the open connection.
    const shutdown = Object.assign(
      new Error("terminating connection due to administrator command"),
      { code: "57P01" },
    );

    reportProcessFailure(
      "billing-worker",
      new Error("job failed", { cause: shutdown }),
    );

    const logged = lines.join("\n");
    expect(logged).toContain("process_stopped");
    expect(logged).not.toContain("operator_attention");
    expect(process.exitCode).toBe(1);
    expect(exit).not.toHaveBeenCalled();
    expect(() => vi.advanceTimersByTime(5_000)).toThrow("process.exit(1)");
  });
});
