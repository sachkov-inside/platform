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
it("retains a safe partial commit report on the error used for failed-job serialization", async () => {
  const first = {
    clean: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        status: "known",
        asOf: "2026-10-21T00:00:00.123456Z",
        cutoff: "2025-10-21T00:00:00.123456Z",
        removed: 7,
        hasMore: true,
        oldestExpiredAt: "2025-10-20T00:00:00.123456Z",
        lagSeconds: 86400,
      },
    }),
  };
  const second = {
    clean: vi.fn().mockRejectedValue(new Error("private-sentinel")),
  };
  let failure: unknown;
  try {
    await runActivityRetentionJob(first, second);
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({
    activityRetention: {
      schemaVersion: 1,
      outcome: "failed",
      sources: [
        {
          source: "learning_started",
          result: { ok: true, value: { removed: 7 } },
        },
        {
          source: "bookmarks",
          result: {
            ok: false,
            status: "unknown",
            error: { code: "source_unavailable" },
          },
        },
      ],
    },
  });
  expect(JSON.stringify(failure)).not.toContain("private-sentinel");
});
it("the pinned pg-boss serialize-error dependency preserves only our safe enumerable partial report", async () => {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const { z } = await import("zod");
  const require = createRequire(import.meta.url);
  const bossRequire = createRequire(require.resolve("pg-boss/package.json"));
  const raw: unknown = await import(
    pathToFileURL(bossRequire.resolve("serialize-error")).href
  );
  const { serializeError } = z
    .object({
      serializeError: z.function({ input: [z.unknown()], output: z.unknown() }),
    })
    .parse(raw);
  const first = {
    clean: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        status: "known",
        asOf: "2026-10-21T00:00:00.123456Z",
        cutoff: "2025-10-21T00:00:00.123456Z",
        removed: 7,
        hasMore: false,
        oldestExpiredAt: null,
        lagSeconds: null,
      },
    }),
  };
  let failure: unknown;
  try {
    await runActivityRetentionJob(first, {
      clean: vi.fn().mockRejectedValue(new Error("private-sentinel")),
    });
  } catch (error) {
    failure = error;
  }
  const serialized = serializeError(failure);
  expect(serialized).toMatchObject({
    message: "activity_retention_failed",
    activityRetention: {
      schemaVersion: 1,
      outcome: "failed",
      sources: [
        {
          source: "learning_started",
          result: {
            ok: true,
            value: { removed: 7, cutoff: "2025-10-21T00:00:00.123456Z" },
          },
        },
        {
          source: "bookmarks",
          result: { ok: false, error: { code: "source_unavailable" } },
        },
      ],
    },
  });
  expect(JSON.stringify(serialized)).not.toContain("private-sentinel");
});
it("projects a recorded partial pass separately from current lag, refusing malformed latest and truncated history", async () => {
  const { activityRetentionLastPass, activityRetentionPass } =
    await import("../../src/infrastructure/activity-retention.js");
  const known = {
    ok: true,
    value: {
      status: "known",
      asOf: "2026-10-21T00:00:00.123456Z",
      cutoff: "2025-10-21T00:00:00.123456Z",
      removed: 7,
      hasMore: false,
      oldestExpiredAt: null,
      lagSeconds: null,
    },
  };
  const report = activityRetentionPass(known, {
    ok: false,
    status: "unknown",
    error: { code: "source_unavailable" },
  });
  const row = {
    asOf: "2026-10-21T00:20:00.123456Z",
    candidateCount: 1,
    headerInvalid: false,
    state: "failed",
    completedAt: "2026-10-21T00:00:01.123456Z",
    ageSeconds: 1199,
    report,
    reportReason: null,
  };
  expect(activityRetentionLastPass([row])).toMatchObject({
    ok: true,
    value: {
      status: "recorded",
      state: "failed",
      freshness: "stale",
      report: {
        sources: [
          { result: { ok: true, value: { removed: 7 } } },
          { result: { ok: false } },
        ],
      },
    },
  });
  expect(
    activityRetentionLastPass([
      { ...row, asOf: "2026-10-21T00:10:01.123456Z", ageSeconds: 600 },
    ]),
  ).toMatchObject({ ok: true, value: { freshness: "recent" } });
  expect(
    activityRetentionLastPass([{ ...row, headerInvalid: true }]),
  ).toMatchObject({ ok: false, error: { code: "invalid_receipt" } });
  expect(
    activityRetentionLastPass([
      { ...row, reportReason: "missing_report", report: null },
    ]),
  ).toMatchObject({ ok: false, error: { code: "missing_report" } });
  expect(
    activityRetentionLastPass([{ ...row, candidateCount: 2001 }]),
  ).toMatchObject({ ok: false, error: { code: "receipt_budget_exceeded" } });
  expect(
    activityRetentionLastPass([
      { ...row, report: { ...report, private: "sentinel" } },
    ]),
  ).toMatchObject({ ok: false, error: { code: "invalid_report" } });
  expect(
    activityRetentionLastPass([
      { ...row, reportReason: "oversized_report", report: null },
    ]),
  ).toMatchObject({ ok: false, error: { code: "oversized_report" } });
  expect(
    activityRetentionLastPass([
      {
        ...row,
        state: null,
        report: null,
        completedAt: null,
        ageSeconds: null,
      },
    ]),
  ).toMatchObject({ ok: false, error: { code: "no_retained_pass" } });
  expect(
    activityRetentionLastPass([{ ...row, state: "completed" }]),
  ).toMatchObject({ ok: false, error: { code: "invalid_report" } });
});
