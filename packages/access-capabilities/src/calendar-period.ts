// Moscow has a fixed +03:00 offset for all supported future subscription instants.
// Always use the original anchor when adding months (Jan 31 -> Feb end -> Mar 31).
/** Москва живёт без перехода на летнее время: календарь billing — UTC+3. */
export const MOSCOW_OFFSET_MS: number = 3 * 60 * 60 * 1000;
export function subscriptionPeriodEnd(anchor: Date, months: number): Date {
  if (
    !Number.isInteger(months) ||
    months < 1 ||
    months > 1200 ||
    !Number.isFinite(anchor.getTime())
  )
    throw new Error("Invalid subscription anchor");
  const local = new Date(anchor.getTime() + MOSCOW_OFFSET_MS);
  const targetMonth = local.getUTCMonth() + months;
  const lastDay = new Date(
    Date.UTC(local.getUTCFullYear(), targetMonth + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      targetMonth,
      Math.min(local.getUTCDate(), lastDay),
      local.getUTCHours(),
      local.getUTCMinutes(),
      local.getUTCSeconds(),
      local.getUTCMilliseconds(),
    ) - MOSCOW_OFFSET_MS,
  );
}
