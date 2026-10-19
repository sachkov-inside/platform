import { z } from "zod";
import { DIAGNOSTIC_SOURCE_ROW_LIMIT } from "./diagnostic-read-budget.js";

export const ACTIVITY_RETENTION_MILLISECONDS = 365 * 86_400_000;
const MAX_ACTIVITY_WINDOW_MILLISECONDS = 31 * 86_400_000;
export const activityWindowSchema = z
  .strictObject({
    from: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
    to: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  })
  .refine(
    ({ from, to }) =>
      to > from &&
      to.getTime() - from.getTime() <= MAX_ACTIVITY_WINDOW_MILLISECONDS,
  );
const activityRowsSchema = z.array(
  z.object({
    account_id: z.uuid(),
    kind: z.enum([
      "learning_started",
      "material_marked_read",
      "material_marked_unread",
      "bookmark_added",
      "bookmark_removed",
      "task_submitted",
    ]),
    event_count: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    first_at: z.date(),
    last_at: z.date(),
  }),
);
export const activityClockSchema = z
  .array(z.object({ as_of: z.date() }))
  .length(1);

/** Shared DTO only: every owner executes its own window-filtered SQL and snapshot. */
export function confirmedActivitySnapshot(
  raw: unknown,
  asOf: Date,
  window: { readonly from: Date; readonly to: Date },
) {
  const rows = activityRowsSchema.parse(raw);
  if (rows.length > DIAGNOSTIC_SOURCE_ROW_LIMIT)
    return {
      ok: false as const,
      coverage: "unknown" as const,
      error: { code: "source_budget_exceeded" as const },
    };
  return {
    ok: true as const,
    value: {
      asOf: asOf.toISOString(),
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      coverage: {
        status: "partial" as const,
        collectionStartedAt: null,
        continuity: "not_proven" as const,
        retentionFrom: new Date(
          asOf.getTime() - ACTIVITY_RETENTION_MILLISECONDS,
        ).toISOString(),
      },
      rows: rows.map((row) => ({
        accountId: row.account_id,
        kind: row.kind,
        eventCount: row.event_count,
        firstOccurredAt: row.first_at.toISOString(),
        lastOccurredAt: row.last_at.toISOString(),
      })),
    },
  };
}
