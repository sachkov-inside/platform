import {
  dayValueRowsSchema,
  type DailyWindow,
  type DayValue,
} from "../../../../infrastructure/contracts/daily-window.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type SalesFunnelPrismaClient,
} from "../../../../infrastructure/prisma/index.js";

export type WaitlistJoinsResult =
  | { readonly ok: true; readonly days: readonly DayValue[] }
  | {
      readonly ok: false;
      readonly error: { readonly code: "dependency_unavailable" };
    };

/**
 * Waitlist joins of every intake per calendar day of the window (#1719): each `joined` event
 * counts, a rejoin after a withdrawal included, as in the funnel report's weekly joins. Days
 * without a join are absent.
 */
export async function countWaitlistJoins(
  prisma: SalesFunnelPrismaClient,
  window: DailyWindow,
): Promise<WaitlistJoinsResult> {
  try {
    const rows: unknown = await prisma.$queryRaw(Prisma.sql`
      SELECT to_char((occurred_at AT TIME ZONE ${window.timeZone})::date, 'YYYY-MM-DD') AS date,
        count(*)::int AS value
      FROM sales_funnel.product_waitlist_events
      WHERE kind = 'joined' AND occurred_at >= ${window.from} AND occurred_at < ${window.to}
      GROUP BY 1 ORDER BY 1
    `);
    return { ok: true, days: dayValueRowsSchema.parse(rows) };
  } catch (error) {
    return dependencyFailure(
      { module: "sales-funnel", operation: "countWaitlistJoins" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } } as const,
    );
  }
}
