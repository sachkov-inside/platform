import { z } from "zod";
import {
  Prisma,
  type BookmarksPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  ACTIVITY_RETENTION_BATCH_SIZE,
  ACTIVITY_RETENTION_SECONDS,
  activityRetentionTransactionOptions,
  activityRetentionStatus,
} from "../../../../infrastructure/activity-retention.js";
/** Deletes only this owner's analytics copy; source state and command receipts remain intact. */
export class BookmarkActivityRetention {
  constructor(
    private readonly prisma: Pick<BookmarksPrismaClient, "$transaction">,
  ) {}
  clean() {
    return this.run(true);
  }
  status() {
    return this.run(false);
  }
  private async run(clean: boolean) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        if (!clean)
          await transaction.$executeRaw(Prisma.sql`set transaction read only`);
        await transaction.$queryRaw(
          Prisma.sql`select set_config('statement_timeout','2000',true)`,
        );
        let removed = 0;
        if (clean)
          removed = z
            .number()
            .int()
            .min(0)
            .max(ACTIVITY_RETENTION_BATCH_SIZE)
            .parse(
              await transaction.$executeRaw(Prisma.sql`
          with expired as (select event_id from bookmarks.activity_events
            where occurred_at < transaction_timestamp()-${ACTIVITY_RETENTION_SECONDS}*interval '1 second'
            order by occurred_at,event_id limit ${ACTIVITY_RETENTION_BATCH_SIZE} for update skip locked)
          delete from bookmarks.activity_events target using expired
          where target.event_id=expired.event_id and target.occurred_at < transaction_timestamp()-${ACTIVITY_RETENTION_SECONDS}*interval '1 second'
        `),
            );
        const raw: unknown = await transaction.$queryRaw(Prisma.sql`
          select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "asOf",
            to_char((transaction_timestamp()-${ACTIVITY_RETENTION_SECONDS}*interval '1 second') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cutoff,
            to_char(oldest.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "oldestExpiredAt",
            date_part('epoch',transaction_timestamp()-${ACTIVITY_RETENTION_SECONDS}*interval '1 second'-oldest.occurred_at)::double precision as "lagSeconds"
          from (select 1) anchor left join lateral (
            select occurred_at from bookmarks.activity_events where occurred_at < transaction_timestamp()-${ACTIVITY_RETENTION_SECONDS}*interval '1 second'
            order by occurred_at,event_id limit 1
          ) oldest on true
        `);
        const status = activityRetentionStatus(raw);
        return {
          ok: true as const,
          value: { ...status, ...(clean ? { removed } : {}) },
        };
      }, activityRetentionTransactionOptions);
    } catch (error) {
      return dependencyFailure(
        {
          module: "bookmarks",
          operation: clean ? "cleanActivity" : "activityRetentionStatus",
        },
        error,
        {
          ok: false as const,
          status: "unknown" as const,
          error: { code: "source_unavailable" as const },
        },
      );
    }
  }
}
