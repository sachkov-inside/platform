import {
  formatCohortDate,
  formatKopecks,
  type ProductCohort,
  type PriceSnapshot,
} from "@/entities/subscription";
import {
  oneTimeOfferTerms,
  oneTimeTermLabels,
} from "@/features/billing-checkout.terms";
import type { CohortCall } from "@/features/ai-engineering-course";
import type { ProductAccess } from "@/features/library-discovery";
import {
  productProgrammeHref,
  productPurchaseHref,
} from "@/shared/routing/subscription-route";

export { formatCohortDate };

/** Якорь нижнего блока страницы курса, где стоят цена и кнопка предзаказа. */
export const cohortEnrollAnchor = "enroll";

/**
 * Плашка и кнопка первого экрана по этапу продаж потока. Этап задаёт обещание, но деньги
 * принимает только предложение, включённое в продажу и видимое этому человеку: без него кнопка
 * ведёт в программу. На анонсе оплаты нет никогда. Тексты — черновик запуска потока 1 из Inside
 * Content, их примет владелец (#814).
 */
export function cohortCall({
  cohort,
  offer,
  productAccess,
  signedIn,
  slug,
}: {
  readonly cohort: ProductCohort | null;
  /** Самый дешёвый вариант продукта, который видит этот человек, или `null`, если продажи нет. */
  readonly offer: PriceSnapshot | null;
  /** Открыт ли продукт этому человеку по его основаниям; тому, у кого он есть, оплата не нужна. */
  readonly productAccess: ProductAccess;
  readonly signedIn: boolean;
  readonly slug: string;
}): CohortCall {
  const programme = productProgrammeHref(slug);
  const openProgramme = {
    kind: "programme",
    href: programme,
    label: "Открыть программу",
  } as const;
  if (cohort === null) return { banner: null, action: null };

  const date =
    cohort.startsOn === null ? "" : formatCohortDate(cohort.startsOn);
  const payable = offer !== null && productAccess !== "open";
  const pay = (label: string) =>
    payable
      ? ({ kind: "purchase", href: productPurchaseHref(slug), label } as const)
      : openProgramme;
  const price = offer === null ? "" : formatKopecks(offer.firstPriceKopecks);
  const label = cohort.name;

  switch (cohort.stage) {
    case "announcement":
      return {
        banner: {
          kind: "card",
          label,
          text: `Старт ${date}. Предзаказ откроется скоро`,
          detail: signedIn
            ? "Читай первую главу бесплатно, пока ждёшь старта"
            : "Войди через Telegram и читай первую главу бесплатно, пока ждёшь старта",
        },
        action: signedIn
          ? {
              kind: "programme",
              href: programme,
              label: "Читать главу 1 бесплатно",
            }
          : {
              kind: "sign-in",
              returnTo: programme,
              label: "Читать главу 1 бесплатно",
            },
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
    case "running":
      return {
        banner: {
          kind: "card",
          label,
          text: `Стартовал ${date}. Присоединиться можно в любой момент`,
          detail:
            "Все вышедшие главы откроются сразу, следующие выходят по порядку программы",
        },
        action: pay(`Оплатить ${price}`),
      };
    case "between":
      return {
        banner: {
          kind: "card",
          label,
          text: `Курс открыт. Следующий поток: ${cohort.nextEvent}`,
          // Срок сопровождения называет предложение; без него в продаже срок назвать нечем.
          detail:
            offer !== null &&
            oneTimeOfferTerms(offer).supportMonths !== undefined
              ? `Проходи в своём темпе, автор сопровождает тебя ${oneTimeTermLabels(oneTimeOfferTerms(offer)).support} после покупки`
              : "Проходи в своём темпе",
        },
        action: pay("Оплатить"),
      };
  }
}
