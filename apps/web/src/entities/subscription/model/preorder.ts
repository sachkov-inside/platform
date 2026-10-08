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

/** Цена предзаказа рядом с ценой после старта: то, что видят плашка, программа и оплата. */
export interface PreorderPrice {
  /** Цена, которую человек платит сейчас. */
  readonly price: string;
  /** Цена после старта потока, зачёркнутая рядом; `null` — владелец её не указал. */
  readonly priceAfterStart: string | null;
  /** День старта словами: «9 ноября». */
  readonly startsOn: string;
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
  };
}

/** Условия предзаказа для страницы оплаты: день старта и цена после него. */
export interface PreorderTerms {
  /** День старта словами: «9 ноября». */
  readonly startsOn: string;
  readonly priceAfterStartKopecks: number | null;
}

/** Условия предзаказа, пока поток на этапе предзаказа; иначе `null`. */
export function preorderTerms(
  cohort: ProductCohort | null,
): PreorderTerms | null {
  if (cohort?.stage !== "preorder" || cohort.startsOn === null) return null;
  return {
    startsOn: formatCohortDate(cohort.startsOn),
    priceAfterStartKopecks: cohort.priceAfterStartKopecks,
  };
}
