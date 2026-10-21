import { ACTIVITY_RETENTION_MILLISECONDS } from "./confirmed-activity.js";
import { z } from "zod";
export const ACTIVITY_RETENTION_SECONDS =
  ACTIVITY_RETENTION_MILLISECONDS / 1000;
export const ACTIVITY_RETENTION_BATCH_SIZE = 1000;
export const activityRetentionTransactionOptions = {
  timeout: 5000,
  maxWait: 1000,
  isolationLevel: "ReadCommitted",
} as const;
export const activityRetentionStatusRows = z
  .array(
    z.object({
      asOf: z.iso.datetime(),
      cutoff: z.iso.datetime(),
      oldestExpiredAt: z.iso.datetime().nullable(),
      lagSeconds: z.number().nonnegative().nullable(),
    }),
  )
  .length(1);
export function activityRetentionStatus(raw: unknown) {
  const row = activityRetentionStatusRows.parse(raw)[0];
  if (
    row === undefined ||
    (row.oldestExpiredAt === null) !== (row.lagSeconds === null)
  )
    throw new Error("Activity retention status unavailable");
  return {
    status: "known" as const,
    ...row,
    hasMore: row.oldestExpiredAt !== null,
  };
}

export const ACTIVITY_RETENTION_REPORT_BYTES = 4096;
const preciseInstant = z.iso.datetime().length(27);
const cleanValue = z
  .strictObject({
    status: z.literal("known"),
    asOf: preciseInstant,
    cutoff: preciseInstant,
    removed: z.number().int().min(0).max(ACTIVITY_RETENTION_BATCH_SIZE),
    hasMore: z.boolean(),
    oldestExpiredAt: preciseInstant.nullable(),
    lagSeconds: z.number().nonnegative().nullable(),
  })
  .refine(
    (value) =>
      value.hasMore === (value.oldestExpiredAt !== null) &&
      (value.oldestExpiredAt === null) === (value.lagSeconds === null) &&
      value.asOf.slice(20) === value.cutoff.slice(20) &&
      Date.parse(value.asOf) - Date.parse(value.cutoff) ===
        ACTIVITY_RETENTION_MILLISECONDS &&
      (value.oldestExpiredAt === null ||
        (value.oldestExpiredAt < value.cutoff &&
          value.lagSeconds !== null &&
          value.lagSeconds > 0)),
  );
export const activityRetentionCleanResultSchema = z.union([
  z.strictObject({ ok: z.literal(true), value: cleanValue }),
  z.strictObject({
    ok: z.literal(false),
    status: z.literal("unknown"),
    error: z.strictObject({ code: z.literal("source_unavailable") }),
  }),
]);
export const activityRetentionPassSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    outcome: z.enum(["completed", "failed"]),
    sources: z.tuple([
      z.strictObject({
        source: z.literal("learning_started"),
        result: activityRetentionCleanResultSchema,
      }),
      z.strictObject({
        source: z.literal("bookmarks"),
        result: activityRetentionCleanResultSchema,
      }),
    ]),
  })
  .refine(
    (value) =>
      (value.outcome === "completed") ===
      value.sources.every((source) => source.result.ok),
  );
export function boundedActivityRetentionPass(raw: unknown) {
  const report = activityRetentionPassSchema.parse(raw);
  if (
    Buffer.byteLength(JSON.stringify(report), "utf8") >
    ACTIVITY_RETENTION_REPORT_BYTES
  )
    throw new Error("activity_retention_report_exceeded");
  return report;
}
export function activityRetentionPass(reading: unknown, bookmarks: unknown) {
  const safe = (raw: unknown) => {
    const parsed = activityRetentionCleanResultSchema.safeParse(raw);
    return parsed.success
      ? parsed.data
      : {
          ok: false as const,
          status: "unknown" as const,
          error: { code: "source_unavailable" as const },
        };
  };
  const sources = [
    { source: "learning_started" as const, result: safe(reading) },
    { source: "bookmarks" as const, result: safe(bookmarks) },
  ] as const;
  return boundedActivityRetentionPass({
    schemaVersion: 1,
    outcome: sources.every((source) => source.result.ok)
      ? "completed"
      : "failed",
    sources,
  });
}

const receiptRows = z
  .array(
    z.strictObject({
      asOf: preciseInstant,
      candidateCount: z.number().int().min(0).max(2001),
      headerInvalid: z.boolean(),
      state: z.enum(["completed", "failed"]).nullable(),
      completedAt: preciseInstant.nullable(),
      ageSeconds: z.number().nullable(),
      report: z.unknown(),
      reportReason: z.enum(["missing_report", "oversized_report"]).nullable(),
    }),
  )
  .length(1);
export function activityRetentionReceiptUnknown(
  code:
    | "source_unavailable"
    | "schema_mismatch"
    | "invalid_receipt"
    | "receipt_budget_exceeded"
    | "no_retained_pass"
    | "missing_report"
    | "oversized_report"
    | "invalid_report",
  asOf?: string,
) {
  return {
    ok: false as const,
    status: "unknown" as const,
    ...(asOf === undefined ? {} : { asOf }),
    error: { code },
  };
}
/** Decodes only the fixed queue's bounded SQL projection, never an arbitrary job output. */
export function activityRetentionLastPass(raw: unknown) {
  const parsed = receiptRows.safeParse(raw);
  const row = parsed.success ? parsed.data[0] : undefined;
  if (row === undefined)
    return activityRetentionReceiptUnknown("invalid_receipt");
  const unknown = (
    code: Parameters<typeof activityRetentionReceiptUnknown>[0],
  ) => activityRetentionReceiptUnknown(code, row.asOf);
  if (row.candidateCount > 2000) return unknown("receipt_budget_exceeded");
  if (row.headerInvalid) return unknown("invalid_receipt");
  if (row.state === null) return unknown("no_retained_pass");
  if (
    row.completedAt === null ||
    row.ageSeconds === null ||
    row.ageSeconds < 0 ||
    row.completedAt > row.asOf
  )
    return unknown("invalid_receipt");
  const ageFromInstants =
    (Date.parse(row.asOf) - Date.parse(row.completedAt)) / 1000;
  if (
    !Number.isFinite(ageFromInstants) ||
    Math.abs(ageFromInstants - row.ageSeconds) > 0.001
  )
    return unknown("invalid_receipt");
  if (row.reportReason !== null) return unknown(row.reportReason);
  const completedAt = row.completedAt;
  let report: ReturnType<typeof boundedActivityRetentionPass>;
  try {
    report = boundedActivityRetentionPass(row.report);
  } catch {
    return unknown("invalid_report");
  }
  if (
    report.sources.some(
      (source) => source.result.ok && source.result.value.asOf > completedAt,
    )
  )
    return unknown("invalid_report");
  if (report.outcome !== row.state) return unknown("invalid_report");
  return {
    ok: true as const,
    value: {
      status: "recorded" as const,
      asOf: row.asOf,
      state: row.state,
      completedAt: row.completedAt,
      ageSeconds: row.ageSeconds,
      freshness:
        row.ageSeconds > 600 ? ("stale" as const) : ("recent" as const),
      report,
    },
  };
}
