import { sql } from "kysely";

// Moscow calendar days and weeks of the Trainer. Moscow keeps UTC+3 all year, so every day is
// 24 hours long and starts at 21:00 UTC.

export const DAY_SECONDS = 24 * 60 * 60;
/** Seconds Moscow time is ahead of UTC. */
export const MOSCOW_OFFSET_SECONDS = 3 * 60 * 60;
/** 1970-01-01 was a Thursday, so Moscow day number 4 was a Monday. */
const A_MONDAY = 4;

/** A stretch of time from `from` up to, but not including, `until`. An absent end is open. */
export interface TrainerTimeWindow {
  readonly from?: Date;
  readonly until?: Date;
}

/** The number of the Moscow calendar day of this instant; the next day has the next number. */
export function moscowDayNumber(at: Date): number {
  return Math.floor(
    (at.getTime() / 1000 + MOSCOW_OFFSET_SECONDS) / DAY_SECONDS,
  );
}

const dayStart = (day: number): Date =>
  new Date((day * DAY_SECONDS - MOSCOW_OFFSET_SECONDS) * 1000);

/** The Moscow calendar day of this instant, from midnight to the next midnight. */
export function moscowDayWindow(at: Date) {
  const day = moscowDayNumber(at);
  return { from: dayStart(day), until: dayStart(day + 1) };
}

/** The Moscow week of this instant, from Monday 00:00 to the next Monday 00:00. */
export function moscowWeekWindow(at: Date) {
  const day = moscowDayNumber(at);
  // The remainder is taken twice so that a day before 1970 also finds its Monday.
  const monday = day - ((((day - A_MONDAY) % 7) + 7) % 7);
  return { from: dayStart(monday), until: dayStart(monday + 7) };
}

/** Moscow calendar date in the Bank's YYYY-MM-DD representation. */
export function moscowDay(at: Date): string {
  return new Date(moscowDayNumber(at) * DAY_SECONDS * 1000)
    .toISOString()
    .slice(0, 10);
}

/** Moscow day number of a persisted timestamp, on the same scale as moscowDayNumber. */
export const moscowDayNumberSql = (column: string) => sql<number>`floor(
  (extract(epoch from ${sql.ref(column)}) + ${MOSCOW_OFFSET_SECONDS}) / ${DAY_SECONDS}
)::integer`;

/** Calendar date of a persisted timestamp in Moscow. */
export const moscowDaySql = (column: string) =>
  sql`(date '1970-01-01' + ${moscowDayNumberSql(column)})`;
