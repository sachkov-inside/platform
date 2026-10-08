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
  if (cohort.stage === "announcement")
    return {
      label: cohort.name,
      title: "Набор на первый поток",
      text: `Старт ${date}. Предзаказ откроется скоро.`,
      price: null,
      purchaseHref: null,
      programmeHref,
    };
  if (cohort.stage !== "preorder") return null;
  const price = preorderPrice(cohort, offer);
  return {
    label: cohort.name,
    title: "Набор на первый поток",
    text: `Первый поток стартует ${date}. После старта цена вырастет.`,
    price,
    purchaseHref: offer === null ? null : productPurchaseHref(slug),
    programmeHref,
  };
}
