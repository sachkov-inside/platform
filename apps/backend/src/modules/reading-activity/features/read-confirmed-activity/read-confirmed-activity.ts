import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type ReadingActivityPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import {
  diagnosticSnapshotOptions,
  setDiagnosticStatementBudget,
  DIAGNOSTIC_SOURCE_ROW_LIMIT,
} from "../../../../infrastructure/diagnostic-read-budget.js";
import {
  activityWindowSchema,
  activityClockSchema,
  ACTIVITY_RETENTION_MILLISECONDS,
  confirmedActivitySnapshot,
} from "../../../../infrastructure/confirmed-activity.js";

/** Internal owner capability; authorization belongs to the eventual diagnostic consumer. */
export class ReadingActivityFacts {
  constructor(private readonly prisma: ReadingActivityPrismaClient) {}
  async read(input: unknown) {
    const parsed = activityWindowSchema.safeParse(input);
    if (!parsed.success)
      return {
        ok: false as const,
        error: { code: "invalid_request" as const },
      };
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw(Prisma.sql`set transaction read only`);
        await setDiagnosticStatementBudget(transaction);
        const clock = activityClockSchema.parse(
          await transaction.$queryRaw(
            Prisma.sql`select transaction_timestamp() as as_of`,
          ),
        )[0];
        if (clock === undefined)
          throw new Error("Activity snapshot clock unavailable");
        if (
          parsed.data.from.getTime() <
          clock.as_of.getTime() - ACTIVITY_RETENTION_MILLISECONDS
        )
          return {
            ok: false as const,
            coverage: "unknown" as const,
            error: { code: "outside_retention" as const },
          };
        const rows: unknown = await transaction.$queryRaw(Prisma.sql`
          select account_id, kind, count(*)::double precision as event_count,
            min(occurred_at) as first_at, max(occurred_at) as last_at
          from (
            select account_id, event_type as kind, occurred_at from reading_activity.events
            where occurred_at >= ${parsed.data.from} and occurred_at < ${parsed.data.to}
            union all
            select account_id, 'learning_started' as kind, occurred_at from reading_activity.learning_started_events
            where occurred_at >= ${parsed.data.from} and occurred_at < ${parsed.data.to}
          ) facts
          group by account_id, kind order by account_id, kind
          limit ${DIAGNOSTIC_SOURCE_ROW_LIMIT + 1}
        `);
        return confirmedActivitySnapshot(rows, clock.as_of, parsed.data);
      }, diagnosticSnapshotOptions);
    } catch (error) {
      return dependencyFailure(
        { module: "reading-activity", operation: "readConfirmedActivity" },
        error,
        {
          ok: false as const,
          coverage: "unknown" as const,
          error: { code: "source_unavailable" as const },
        },
      );
    }
  }
}
