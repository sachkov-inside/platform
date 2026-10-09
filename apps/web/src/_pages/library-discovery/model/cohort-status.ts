import {
  formatCohortDate,
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
}: {
  readonly cohort: ProductCohort | null;
  readonly offer: PriceSnapshot | null;
  readonly productAccess: ProductAccess;
  readonly slug: string;
}): CohortStatus | null {
  if (cohort === null || productAccess === "open") return null;
  const { startsOn } = cohort;
  if (startsOn === null) return null;
  const date = formatCohortDate(startsOn);
  const programmeHref = productProgrammeHref(slug);
  const label = `${cohort.name} · старт ${date}`;
  if (cohort.stage === "announcement")
    return {
      label,
      title: "Набор на первый поток",
      text: "Предзаказ откроется скоро. До старта курс будет стоить дешевле.",
      price: null,
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
    discount: discountLabel(cohort, offer),
    purchaseHref: offer === null ? null : productPurchaseHref(slug),
    programmeHref,
  };
}

/**
 * Скидка предзаказа к цене после старта, округлённая вниз, чтобы не обещать больше, чем есть:
 * 29 900 ₽ к 39 900 ₽ — «−25 %». Без цены после старта сравнивать не с чем.
 */
function discountLabel(
  cohort: ProductCohort,
  offer: PriceSnapshot | null,
): string | null {
  const after = cohort.priceAfterStartKopecks;
  if (offer === null || after === null || after <= offer.firstPriceKopecks)
    return null;
  const percent = Math.floor((1 - offer.firstPriceKopecks / after) * 100);
  return percent < 1 ? null : `−${String(percent)}\u00a0%`;
}
