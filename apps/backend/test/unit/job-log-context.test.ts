import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { dependencyFailure, observeJob } from "../../src/infrastructure/observability/index.js";

const logRecord = z.record(z.string(), z.unknown());

describe("job log context", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ties a dependency failure inside a job to that job run and names the job's own failure", async () => {
    const lines = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const job = observeJob("billing-worker", "billing.payment-recovery", () => {
      dependencyFailure({ module: "billing", operation: "recover" }, new Error("socket hang up"), null);
      return Promise.reject(new Error("dependency_unavailable"));
    });

    await expect(job([{ id: "0b8a5b9e-5c43-4f53-9d0a-2f1c9e7d6a11" }])).rejects.toThrow("dependency_unavailable");

    const records = lines.mock.calls.map(([line]) => logRecord.parse(JSON.parse(String(line))));
    const unitOfWork = {
      process: "billing-worker",
      queue: "billing.payment-recovery",
      requestId: "0b8a5b9e-5c43-4f53-9d0a-2f1c9e7d6a11",
    };
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ ...unitOfWork, event: "dependency_failure", module: "billing", operation: "recover" });
    expect(records[1]).toMatchObject({ ...unitOfWork, event: "job_failed", error: { message: "dependency_unavailable" } });
  });
});
