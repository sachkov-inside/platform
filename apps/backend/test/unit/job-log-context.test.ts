import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  dependencyFailure,
  observeJob,
} from "../../src/infrastructure/observability/index.js";

const logRecord = z.record(z.string(), z.unknown());

describe("job log context", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ties a dependency failure inside a job to that job run and names the job's own failure", async () => {
    const lines = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const job = observeJob("billing-worker", "billing.payment-recovery", () => {
      dependencyFailure(
        { module: "billing", operation: "recover" },
        new Error("socket hang up"),
        null,
      );
      return Promise.reject(new Error("dependency_unavailable"));
    });

    await expect(
      job([{ id: "0b8a5b9e-5c43-4f53-9d0a-2f1c9e7d6a11" }]),
    ).rejects.toThrow("dependency_unavailable");

    const records = lines.mock.calls.map(([line]) =>
      logRecord.parse(JSON.parse(String(line))),
    );
    const unitOfWork = {
      process: "billing-worker",
      queue: "billing.payment-recovery",
      requestId: "0b8a5b9e-5c43-4f53-9d0a-2f1c9e7d6a11",
    };
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      ...unitOfWork,
      event: "dependency_failure",
      module: "billing",
      operation: "recover",
    });
    expect(records[1]).toMatchObject({
      ...unitOfWork,
      event: "job_failed",
      error: { message: "dependency_unavailable" },
    });
  });
});

it("records a successful handler result after its work settles and preserves the result", async () => {
  const events: string[] = [];
  const result = { ok: true };
  const jobs = [{ id: "0b8a5b9e-5c43-4f53-9d0a-2f1c9e7d6a11" }];
  const completed = vi.fn((queue, batch) => {
    expect(queue).toBe("billing.payment-recovery");
    expect(batch).toBe(jobs);
    events.push("observation_committed");
    return Promise.resolve();
  });
  const handler = observeJob(
    "billing-worker",
    "billing.payment-recovery",
    () => {
      events.push("business_committed");
      return Promise.resolve(result);
    },
    undefined,
    { completed },
  );
  expect(await handler(jobs)).toBe(result);
  expect(events).toEqual(["business_committed", "observation_committed"]);
});

it("an observation failure cannot retry successful business work or replace a handler error", async () => {
  const lines = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const completed = vi
      .fn()
      .mockRejectedValue(new Error("observer_unavailable"));
    const result = { ok: true };
    const success = observeJob(
      "billing-worker",
      "billing.payment-recovery",
      () => Promise.resolve(result),
      undefined,
      { completed },
    );
    expect(
      await success([{ id: "0b8a5b9e-5c43-4f53-9d0a-2f1c9e7d6a11" }]),
    ).toBe(result);
    expect(completed).toHaveBeenCalledOnce();
    const primary = new Error("business_failed");
    const failed = observeJob(
      "billing-worker",
      "billing.payment-recovery",
      () => Promise.reject(primary),
      undefined,
      { completed },
    );
    await expect(
      failed([{ id: "0b8a5b9e-5c43-4f53-9d0a-2f1c9e7d6a11" }]),
    ).rejects.toBe(primary);
    expect(completed).toHaveBeenCalledOnce();
    const records = lines.mock.calls.map(([line]) =>
      logRecord.parse(JSON.parse(String(line))),
    );
    expect(records.filter((row) => row["event"] === "job_failed")).toHaveLength(
      1,
    );
    expect(
      records.filter((row) => row["event"] === "dependency_failure"),
    ).toHaveLength(1);
  } finally {
    lines.mockRestore();
  }
});
