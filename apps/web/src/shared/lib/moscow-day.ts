/**
 * Календарные дни по Москве для полей дат и периодов админки: день «YYYY-MM-DD» и его границы как
 * моменты. Москва живёт без перехода на летнее время, поэтому смещение постоянно и сутки всегда
 * длятся 24 часа. Подписи дат для экрана живут в `moscow-format`.
 */

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
/** Смещение Москвы от UTC в записи ISO. */
export const MOSCOW_UTC_OFFSET = "+03:00";
const MOSCOW_UTC_OFFSET_MS = 3 * HOUR_MS;

/** Календарный день по Москве, в который приходится момент. */
export function moscowDayOf(instant: Date | number): string {
  const time = typeof instant === "number" ? instant : instant.getTime();
  return new Date(time + MOSCOW_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/** Начало московских суток дня «YYYY-MM-DD» строкой ISO со смещением Москвы. */
export function moscowDayStartIso(day: string): string {
  return `${day}T00:00:00${MOSCOW_UTC_OFFSET}`;
}

/** Начало московских суток дня «YYYY-MM-DD» как момент. */
export function moscowDayStart(day: string): Date {
  return new Date(moscowDayStartIso(day));
}

/** День, отстоящий от дня «YYYY-MM-DD» на `days` суток (отрицательное число: раньше). */
export function addMoscowDays(day: string, days: number): string {
  return moscowDayOf(moscowDayStart(day).getTime() + days * DAY_MS);
}
