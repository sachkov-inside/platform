import type { DayValue } from "../../../infrastructure/contracts/daily-window.js";
import {
  OVERVIEW_TIME_ZONE,
  type OverviewPeriod,
  type OverviewPeriodDays,
  type OverviewSeries,
} from "../shared/overview-contract.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const calendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: OVERVIEW_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** The wall clock of `instant` in Moscow, read back as if it were UTC. */
function wallClockAsUtc(instant: number): number {
  const parts = Object.fromEntries(
    calendar
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    Number(parts["hour"]),
    Number(parts["minute"]),
    Number(parts["second"]),
  );
}

/** The Moscow calendar day of an instant, `YYYY-MM-DD`. */
export function moscowDay(instant: Date): string {
  return new Date(wallClockAsUtc(instant.getTime())).toISOString().slice(0, 10);
}

/** The calendar day `offset` days after `day`. */
export function shiftDay(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** The instant Moscow's `day` starts, whatever offset the zone has on that day. */
export function moscowStartOf(day: string): Date {
  const midnight = Date.parse(`${day}T00:00:00Z`);
  const offset = wallClockAsUtc(midnight) - midnight;
  const guess = midnight - offset;
  return new Date(midnight - (wallClockAsUtc(guess) - guess));
}

/**
 * The current period is the last `days` Moscow days with today, the previous one the `days`
 * days right before it. Both come from one reading of the clock.
 */
export function overviewPeriod(
  now: Date,
  days: OverviewPeriodDays,
): OverviewPeriod {
  const today = moscowDay(now);
  const range = (firstDay: string, lastDay: string) => ({
    from: moscowStartOf(firstDay).toISOString(),
    to: moscowStartOf(shiftDay(lastDay, 1)).toISOString(),
    firstDay,
    lastDay,
  });
  return {
    days,
    timeZone: OVERVIEW_TIME_ZONE,
    current: range(shiftDay(today, 1 - days), today),
    previous: range(shiftDay(today, 1 - 2 * days), shiftDay(today, -days)),
  };
}

/** The window both periods span, as the owners' daily reads take it. */
export function spannedWindow(period: OverviewPeriod) {
  return {
    from: new Date(period.previous.from),
    to: new Date(period.current.to),
    timeZone: OVERVIEW_TIME_ZONE,
  };
}

/** Every day of one period range, zeros included, from an owner's sparse days. */
export function seriesOf(
  range: OverviewPeriod["current"],
  days: readonly DayValue[],
): OverviewSeries {
  const values = new Map<string, number>();
  for (const day of days)
    values.set(day.date, (values.get(day.date) ?? 0) + day.value);
  const daily: { date: string; value: number }[] = [];
  for (
    let date = range.firstDay;
    date <= range.lastDay;
    date = shiftDay(date, 1)
  )
    daily.push({ date, value: values.get(date) ?? 0 });
  return {
    total: daily.reduce((sum, day) => sum + day.value, 0),
    daily,
  };
}
