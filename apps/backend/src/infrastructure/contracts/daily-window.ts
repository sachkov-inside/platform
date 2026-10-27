import { z } from "zod";

/**
 * A half-open window of instants `[from, to)` counted by calendar days of `timeZone`. The Overview
 * (#1719) hands it to the owners of each fact; each owner groups its own rows by
 * `(instant AT TIME ZONE timeZone)::date`, so every owner draws the day boundary in one place.
 */
export interface DailyWindow {
  readonly from: Date;
  readonly to: Date;
  /** An IANA zone name such as `Europe/Moscow`. */
  readonly timeZone: string;
}

/** One calendar day's value. A day without rows is absent; the reader fills the zeros. */
export interface DayValue {
  readonly date: string;
  readonly value: number;
}

/** The row shape of a raw daily aggregate: `date` as `YYYY-MM-DD`, `value` as an integer. */
export const dayValueRowsSchema = z.array(
  z.object({
    date: z.iso.date(),
    value: z.coerce.number().int(),
  }),
);
