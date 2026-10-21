import { expect, it, vi } from "vitest";
import { runActivityRetentionJob } from "../../src/entrypoints/billing-worker/jobs.js";
it("settles both independent owner outcomes before failing a partial cleanup job", async () => {
  const first = {
    clean: vi.fn().mockRejectedValue(new Error("private failure")),
  };
  const second = {
    clean: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        status: "known",
        asOf: "2026-10-21T00:00:00.000000Z",
        cutoff: "2025-10-21T00:00:00.000000Z",
        removed: 1,
        hasMore: false,
        oldestExpiredAt: null,
        lagSeconds: null,
      },
    }),
  };
  await expect(runActivityRetentionJob(first, second)).rejects.toThrow(
    "activity_retention_failed",
  );
  expect(second.clean).toHaveBeenCalledOnce();
});
