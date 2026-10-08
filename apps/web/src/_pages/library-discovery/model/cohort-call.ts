import {
  formatCohortDate,
  formatKopecks,
  preorderPrice,
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
  if (cohort === null)
    return { banner: null, action: openProgramme, compactOnPhone: true };

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
        compactOnPhone: false,
      };
    case "preorder": {
      const preorder = preorderPrice(cohort, offer);
      const afterStart = preorder?.priceAfterStart ?? null;
      return {
        banner: {
          label,
          text: `Набор на первый поток. Старт ${date}`,
          detail:
            afterStart === null
              ? "Предзаказ до старта дешевле. Сообщество и все опубликованные главы сразу после оплаты"
              : `До старта — ${price} вместо ${afterStart}. Сообщество и все опубликованные главы сразу после оплаты`,
        },
        action: pay("Оформить предзаказ"),
        compactOnPhone: false,
      };
    }
    case "running":
      return {
        banner: {
          label,
          text: `Стартовал ${date}. Присоединиться можно в любой момент`,
          detail:
            "Все вышедшие главы откроются сразу, следующие выходят по порядку программы",
        },
        action: pay(`Оплатить ${price}`),
        compactOnPhone: false,
      };
    case "between":
      return {
        banner: {
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
        compactOnPhone: false,
      };
  }
}
