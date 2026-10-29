import {
  cohortToday,
  formatCohortDate,
  formatKopecks,
  formatDaysUntilStart,
  preorderDiscount,
  preorderPrice,
  type PriceSnapshot,
  type ProductSalesState,
} from "@/entities/subscription";
import type { CohortStatus } from "@/features/ai-engineering-course";
import type { ProductAccess } from "@/features/library-discovery";
import {
  productProgrammeHref,
  productPurchaseHref,
} from "@/shared/routing/subscription-route";

/**
 * Билет в нижнем блоке страницы курса по этапу потока, или `null`, когда билета нет: продукт этому
 * человеку уже открыт, поток не задан или поток идёт без продажи. Тогда блок показывает свой
 * текст из описания курса. Решение владельца 08.10.2026 (inside-content#32); после старта и между
 * потоками билет продаёт доступ по цене предложения, а вторая ссылка зовёт попробовать бесплатно,
 * когда в курсе есть бесплатные уроки (решение владельца 29.10.2026, #1647).
 */
export function cohortStatus({
  cohort,
  offer,
  productAccess,
  slug,
  freeStart = false,
  today = cohortToday(),
}: {
  readonly cohort: ProductSalesState | null;
  readonly offer: PriceSnapshot | null;
  readonly productAccess: ProductAccess;
  readonly slug: string;
  /** Есть ли в курсе бесплатные уроки: тогда программа открывается приглашением попробовать. */
  readonly freeStart?: boolean;
  /** Сегодняшний день `YYYY-MM-DD` по Москве; демо и тесты задают его сами. */
  readonly today?: string;
}): CohortStatus | null {
  if (cohort === null || productAccess === "open") return null;
  const { startsOn } = cohort;
  const programmeHref = productProgrammeHref(slug);
  const purchaseHref = offer === null ? null : productPurchaseHref(slug);
  if (cohort.stage === "running" || cohort.stage === "between") {
    if (offer === null) return null;
    return {
      kind: "access",
      countdown: null,
      title: "Присоединяйся к курсу",
      text:
        cohort.stage === "running"
          ? `Поток стартовал${startsOn === null ? "" : ` ${formatCohortDate(startsOn)}`}. Присоединиться можно в любой момент: вышедшие главы откроются сразу.`
          : `Проходи в своём темпе.${cohort.nextEvent === "" ? "" : ` Следующий поток: ${cohort.nextEvent}.`}`,
      // Цена потока выше цены предложения — значит, действует скидка: старая цена зачёркнута.
      price: {
        price: formatKopecks(offer.firstPriceKopecks),
        priceAfterStart:
          cohort.priceAfterStartKopecks !== null &&
          cohort.priceAfterStartKopecks > offer.firstPriceKopecks
            ? formatKopecks(cohort.priceAfterStartKopecks)
            : null,
        startsOn: startsOn === null ? "" : formatCohortDate(startsOn),
        daysLeft: "",
      },
      discount: preorderDiscount(
        offer.firstPriceKopecks,
        cohort.priceAfterStartKopecks,
      ),
      purchaseHref,
      programmeHref,
      freeStart,
    };
  }
  if (startsOn === null) return null;
  const date = formatCohortDate(startsOn);
  // Наклейка на билете называет, сколько дней до старта; дата словами остаётся в тексте.
  const countdown = formatDaysUntilStart(startsOn, today);
  if (cohort.stage === "announcement")
    return {
      kind: "preorder",
      countdown,
      title: "Набор на первый поток",
      text: "Предзаказ откроется скоро. До старта курс будет стоить дешевле.",
      price: null,
      discount: null,
      purchaseHref: null,
      programmeHref,
      freeStart,
    };
  const price = preorderPrice(cohort, offer, today);
  return {
    kind: "preorder",
    countdown,
    title: "Набор на первый поток",
    text: `До старта курс стоит дешевле. Цена вырастет ${date}.`,
    price,
    discount:
      offer === null
        ? null
        : preorderDiscount(
            offer.firstPriceKopecks,
            cohort.priceAfterStartKopecks,
          ),
    purchaseHref,
    programmeHref,
    freeStart,
  };
}
