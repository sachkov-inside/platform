/**
 * Даты, суммы и числа админки на русском и по московскому времени. Экран не показывает ISO-строк и
 * копеек: каждый модуль берёт подпись отсюда, поэтому один факт везде выглядит одинаково.
 * Модуль чистый и без React: его вызывают и сервер, и браузер, и проверки.
 */

import { z } from "zod";

export const MOSCOW_TIME_ZONE = "Europe/Moscow";

const dateTimeFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: MOSCOW_TIME_ZONE,
});
const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeZone: MOSCOW_TIME_ZONE,
});
const instantShortDayFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: MOSCOW_TIME_ZONE,
});
// Календарный день без времени («2026-10-10») уже московский день, а не момент: сдвиг пояса
// к нему не применяется, иначе полночь UTC превратилась бы в другой день.
const calendarShortDayFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const calendarDateFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeZone: "UTC",
});
const rublesFormat = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  trailingZeroDisplay: "stripIfInteger",
});
const wholeRublesInputFormat = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});
const fractionalRublesInputFormat = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const pluralRules = new Intl.PluralRules("ru-RU");

/** A calendar day «YYYY-MM-DD», validated by the schema library rather than a handwritten pattern. */
const calendarDaySchema = z.iso.date();

function isCalendarDay(value: string): boolean {
  return calendarDaySchema.safeParse(value).success;
}
// «24 окт. 2026 г.» → «24 окт. 2026»: в плотных строках админки год без «г.» читается так же.
// «г.» после года отделён пробелом; без него это конец месяца («авг.»), и его не трогаем.
const yearSuffixPattern = /\s+г\./u;

/** «24 окт. 2026, 14:05» по московскому времени. */
export function formatMoscowDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso)).replace(yearSuffixPattern, "");
}

/** «24 окт. 2026»: момент по московскому времени или календарный день «YYYY-MM-DD» как есть. */
export function formatMoscowDate(iso: string): string {
  const format = isCalendarDay(iso) ? calendarDateFormat : dateFormat;
  return format.format(new Date(iso)).replace(yearSuffixPattern, "");
}

/** «10 окт» для подписей осей и коротких списков; «10 мая» остаётся полным словом. */
export function formatMoscowShortDay(iso: string): string {
  const format = isCalendarDay(iso)
    ? calendarShortDayFormat
    : instantShortDayFormat;
  return format.format(new Date(iso)).replace(/\.$/u, "");
}

/** Целые копейки → «4 990 ₽», «1 234,50 ₽». */
export function formatRubles(kopecks: number): string {
  return rublesFormat.format(kopecks / 100);
}

/** Целые копейки → текст поля суммы без знака рубля: «4 990», «1 234,50». */
export function formatRublesInput(kopecks: number): string {
  return kopecks % 100 === 0
    ? wholeRublesInputFormat.format(kopecks / 100)
    : fractionalRublesInputFormat.format(kopecks / 100);
}

/** Формы слова для 1, 2 и 5: `["материал", "материала", "материалов"]`. */
export type RussianPluralForms = readonly [
  one: string,
  few: string,
  many: string,
];

/** Слово в форме, согласованной с числом: 1 материал, 3 материала, 12 материалов. */
export function pluralRu(count: number, forms: RussianPluralForms): string {
  if (!Number.isInteger(count)) return forms[1];
  // В ru-RU правила дают только «one», «few» и «many».
  const category = pluralRules.select(count);
  if (category === "one") return forms[0];
  if (category === "few") return forms[1];
  return forms[2];
}

const countFormat = new Intl.NumberFormat("ru-RU");

/** «12 материалов», «1 234 продажи». */
export function formatCountRu(
  count: number,
  forms: RussianPluralForms,
): string {
  return `${countFormat.format(count)} ${pluralRu(count, forms)}`;
}

const rublesInputPattern = /^(\d+)(?:[.,](\d{1,2}))?$/u;
// `\s` в JavaScript включает и неразрывные пробелы U+00A0 и U+202F, которые ставит `Intl`.
const ignoredInputCharacters = /[\s₽]|руб\.?|р\.?$/gu;

/**
 * Текст поля суммы → целые копейки. Принимает «1 234,50», «1234.5», «4990 ₽», пробелы и
 * неразрывные пробелы. Пустое поле, отрицательное число, больше двух знаков после запятой и любой
 * другой текст дают `null`.
 */
export function parseRublesInput(text: string): number | null {
  const compact = text.trim().toLowerCase().replace(ignoredInputCharacters, "");
  const match = rublesInputPattern.exec(compact);
  if (match === null) return null;
  const rubles = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const kopecks = rubles * 100 + Number(fraction);
  return Number.isSafeInteger(kopecks) ? kopecks : null;
}
