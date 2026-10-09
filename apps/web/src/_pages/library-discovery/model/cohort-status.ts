import {
  cohortToday,
  formatCohortDate,
  formatDaysUntilStart,
  preorderDiscount,
  preorderPrice,
  type PriceSnapshot,
  type ProductCohort,
} from "@/entities/subscription";
import type { CohortStatus } from "@/features/ai-engineering-course";
import type { ProductAccess } from "@/features/library-discovery";
import {
  productProgrammeHref,
  productPurchaseHref,
} from "@/shared/routing/subscription-route";

/**
 * Плашка набора в нижнем блоке страницы курса по этапу потока, или `null`, когда набора нет:
 * поток идёт, между потоками или продукт этому человеку уже открыт. Тогда блок показывает свой
 * текст из описания курса. Решение владельца 08.10.2026 (inside-content#32).
 */
export function cohortStatus({
  cohort,
  offer,
  productAccess,
  slug,
  today = cohortToday(),
}: {
  readonly cohort: ProductCohort | null;
  readonly offer: PriceSnapshot | null;
  readonly productAccess: ProductAccess;
  readonly slug: string;
  /** Сегодняшний день `YYYY-MM-DD` по Москве; демо и тесты задают его сами. */
  readonly today?: string;
}): CohortStatus | null {
  if (cohort === null || productAccess === "open") return null;
  const { startsOn } = cohort;
  if (startsOn === null) return null;
  const date = formatCohortDate(startsOn);
  const programmeHref = productProgrammeHref(slug);
  // Поток уже назван в заголовке «Набор на первый поток», метка называет только день старта.
  const label = `Старт ${date}`;
  if (cohort.stage === "announcement")
    return {
      label,
      title: "Набор на первый поток",
      text: "Предзаказ откроется скоро. До старта курс будет стоить дешевле.",
      price: null,
      priceNote: null,
      discount: null,
      purchaseHref: null,
      programmeHref,
    };
  if (cohort.stage !== "preorder") return null;
  const price = preorderPrice(cohort, offer);
  return {
    label,
    title: "Набор на первый поток",
    text: `До старта курс стоит дешевле. Цена вырастет ${date}.`,
    price,
    priceNote: formatDaysUntilStart(startsOn, today),
    discount:
      offer === null
        ? null
        : preorderDiscount(
            offer.firstPriceKopecks,
            cohort.priceAfterStartKopecks,
          ),
    purchaseHref: offer === null ? null : productPurchaseHref(slug),
    programmeHref,
  };
}
