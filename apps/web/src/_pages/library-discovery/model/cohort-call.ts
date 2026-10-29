import {
  formatCohortDate,
  type ProductSalesState,
  type PriceSnapshot,
} from "@/entities/subscription";
import {
  courseLearningAction,
  type CohortCall,
} from "@/features/ai-engineering-course";
import type { ProductAccess } from "@/features/library-discovery";
import { productProgrammeHref } from "@/shared/routing/subscription-route";

export { formatCohortDate };

/** Якорь нижнего блока страницы курса, где стоят цена и кнопка предзаказа. */
export const cohortEnrollAnchor = "enroll";

/**
 * Плашка и кнопка первого экрана по этапу продаж потока. Первый экран денег не берёт: пока
 * предложение включено в продажу и видно этому человеку, живая метка набора ведёт к билету с ценой
 * внизу страницы (#1647); без продажи кнопка ведёт в программу. Тексты — черновик запуска потока 1
 * из Inside Content, их примет владелец (#814).
 */
export function cohortCall({
  cohort,
  offer,
  productAccess,
  slug,
  continuationMaterialSlug = null,
  freeStart = false,
}: {
  readonly cohort: ProductSalesState | null;
  /** Самый дешёвый вариант продукта, который видит этот человек, или `null`, если продажи нет. */
  readonly offer: PriceSnapshot | null;
  /** Открыт ли продукт этому человеку по его основаниям; тому, у кого он есть, оплата не нужна. */
  readonly productAccess: ProductAccess;
  readonly signedIn: boolean;
  readonly slug: string;
  readonly continuationMaterialSlug?: string | null;
  /**
   * В курсе есть бесплатные уроки, и тот, кому он закрыт, видит на анимации «Попробовать
   * бесплатно» в программу: вторая кнопка туда же первому экрану не нужна (#1647).
   */
  readonly freeStart?: boolean;
}): CohortCall {
  const programme = productProgrammeHref(slug);
  const openProgramme = {
    kind: "programme",
    href: programme,
    label: "Открыть программу",
  } as const;
  if (productAccess === "open")
    return {
      banner: null,
      action: courseLearningAction(slug, continuationMaterialSlug),
    };
  if (cohort === null) return { banner: null, action: null };
  const programmeAction = freeStart ? null : openProgramme;

  const payable = offer !== null;

  switch (cohort.stage) {
    case "announcement":
      return {
        banner: null,
        action: programmeAction,
      };
    case "preorder":
      // Первый экран только сообщает о наборе и ведёт к цене внизу страницы; предзаказ
      // оформляют там, когда курс изучен (решение владельца 09.10.2026).
      return {
        banner: {
          kind: "live",
          text: "Идёт набор на первый поток",
          // Сколько дней до старта, говорит наклейка на анимации; метка остаётся короткой и на
          // узком телефоне помещается в одну строку.
          detail: "",
          href: `#${cohortEnrollAnchor}`,
        },
        action: null,
      };
    // После старта и между потоками цены и кнопки оплаты на первом экране нет: живая метка
    // ведёт к билету с ценой внизу страницы (решение владельца 29.10.2026, #1647). Без продажи
    // билета нет, и кнопка ведёт в программу.
    case "running":
    case "between":
      return payable
        ? {
            banner: {
              kind: "live",
              text: "Идёт набор на курс",
              detail: "",
              href: `#${cohortEnrollAnchor}`,
            },
            action: null,
          }
        : { banner: null, action: programmeAction };
  }
}
