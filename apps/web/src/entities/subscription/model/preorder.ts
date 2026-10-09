import type { PriceSnapshot, ProductCohort } from "./billing-contract";
import { formatKopecks } from "./presentation";

const cohortDate = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** Дата старта — календарный день из каталога: часовой пояс читателя её не сдвигает. */
export function formatCohortDate(startsOn: string): string {
  return cohortDate.format(new Date(`${startsOn}T00:00:00Z`));
}

const moscowDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Moscow",
});

/** Сегодняшний день по Москве, `YYYY-MM-DD`: от него считают, сколько дней до старта. */
export function cohortToday(now: Date = new Date()): string {
  return moscowDay.format(now);
}

/**
 * Сколько дней осталось до старта, словами: «до старта 31 день», в день старта — «старт
 * сегодня». Если день старта прошёл, а поток ещё на предзаказе, называется дата.
 */
export function formatDaysUntilStart(startsOn: string, today: string): string {
  const days = Math.round(
    (Date.parse(`${startsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
  if (days < 0 || Number.isNaN(days))
    return `старт ${formatCohortDate(startsOn)}`;
  if (days === 0) return "старт сегодня";
  return `до старта ${String(days)} ${dayWord(days)}`;
}

function dayWord(days: number): string {
  const tens = days % 100;
  const ones = days % 10;
  if (tens >= 11 && tens <= 14) return "дней";
  if (ones === 1) return "день";
  if (ones >= 2 && ones <= 4) return "дня";
  return "дней";
}

/** Цена предзаказа рядом с ценой после старта: то, что видят плашка, программа и оплата. */
export interface PreorderPrice {
  /** Цена, которую человек платит сейчас. */
  readonly price: string;
  /** Цена после старта потока, зачёркнутая рядом; `null` — владелец её не указал. */
  readonly priceAfterStart: string | null;
  /** День старта словами: «9 ноября». */
  readonly startsOn: string;
  /** Сколько дней до старта: «до старта 31 день». */
  readonly daysLeft: string;
}

/**
 * Предзаказ есть, пока поток на этапе предзаказа и продукт продаётся. Цену после старта задаёт
 * поток: она только показывается, списывается всегда цена предложения (решение владельца
 * 08.10.2026: в день старта цену предложения меняют вручную). Зачёркивать имеет смысл только
 * большую цену.
 */
export function preorderPrice(
  cohort: ProductCohort | null,
  offer: PriceSnapshot | null,
  today: string = cohortToday(),
): PreorderPrice | null {
  if (
    cohort?.stage !== "preorder" ||
    cohort.startsOn === null ||
    offer === null
  )
    return null;
  const after = cohort.priceAfterStartKopecks;
  return {
    price: formatKopecks(offer.firstPriceKopecks),
    priceAfterStart:
      after !== null && after > offer.firstPriceKopecks
        ? formatKopecks(after)
        : null,
    startsOn: formatCohortDate(cohort.startsOn),
    daysLeft: formatDaysUntilStart(cohort.startsOn, today),
  };
}

/**
 * Наклейка «до старта N дней» для анимации курса: пока поток набирается — на анонсе и на
 * предзаказе — и день старта известен. После старта и между потоками наклейки нет.
 */
export function cohortCountdown(
  cohort: ProductCohort | null,
  today: string = cohortToday(),
): string | null {
  const startsOn = cohort?.startsOn ?? null;
  if (startsOn === null) return null;
  if (cohort?.stage !== "preorder" && cohort?.stage !== "announcement")
    return null;
  return formatDaysUntilStart(startsOn, today);
}

/** Условия предзаказа для страницы оплаты: день старта и цена после него. */
export interface PreorderTerms {
  /** День старта словами: «9 ноября». */
  readonly startsOn: string;
  /** Сколько дней до старта: «до старта 31 день». */
  readonly daysLeft: string;
  readonly priceAfterStartKopecks: number | null;
}

/** Условия предзаказа, пока поток на этапе предзаказа; иначе `null`. */
export function preorderTerms(
  cohort: ProductCohort | null,
  today: string = cohortToday(),
): PreorderTerms | null {
  if (cohort?.stage !== "preorder" || cohort.startsOn === null) return null;
  return {
    startsOn: formatCohortDate(cohort.startsOn),
    daysLeft: formatDaysUntilStart(cohort.startsOn, today),
    priceAfterStartKopecks: cohort.priceAfterStartKopecks,
  };
}

/**
 * Скидка предзаказа к цене после старта, округлённая вниз, чтобы не обещать больше, чем есть:
 * 29 900 ₽ к 39 900 ₽ — «−25 %». Без большей цены после старта сравнивать не с чем.
 */
export function preorderDiscount(
  priceKopecks: number,
  afterStartKopecks: number | null,
): string | null {
  if (afterStartKopecks === null || afterStartKopecks <= priceKopecks)
    return null;
  const percent = Math.floor((1 - priceKopecks / afterStartKopecks) * 100);
  return percent < 1 ? null : `−${String(percent)}\u00a0%`;
}
