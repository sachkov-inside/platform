import type { MaterialPreview } from "@/entities/material";
import {
  formatKopecks,
  type GuideCohort,
  type PriceSnapshot,
} from "@/entities/subscription";
import type { CohortCall } from "@/features/ai-engineering-course";
import {
  guideProgrammeHref,
  guidePurchaseHref,
} from "@/shared/routing/subscription-route";

/**
 * Открыт ли продукт этому человеку, насколько это видно по его программе: платные уроки открыты
 * — продукт у него есть; хоть один закрыт — нет. Пока в программе нет ни одного платного урока,
 * ответа нет, и страница не прячет оплату от того, кому она может быть нужна.
 */
export type ProductOwnership = "holds" | "lacks" | "unknown";

export function productOwnership(
  items: readonly Pick<MaterialPreview, "access" | "availability">[],
): ProductOwnership {
  const paid = items.filter((item) => item.access === "membership");
  if (paid.length === 0) return "unknown";
  return paid.some((item) => item.availability === "locked")
    ? "lacks"
    : "holds";
}

const cohortDate = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** Дата старта — календарный день из каталога: часовой пояс читателя её не сдвигает. */
export function formatCohortDate(startsOn: string): string {
  return cohortDate.format(new Date(`${startsOn}T00:00:00Z`));
}

/**
 * Плашка и кнопка первого экрана по этапу продаж потока. Этап задаёт обещание, но деньги
 * принимает только предложение, включённое в продажу и видимое этому человеку: без него кнопка
 * ведёт в программу. На анонсе оплаты нет никогда. Тексты — черновик запуска потока 1 из Inside
 * Content, их примет владелец (#814).
 */
export function cohortCall({
  cohort,
  offer,
  ownership,
  signedIn,
  slug,
}: {
  readonly cohort: GuideCohort | null;
  /** Самый дешёвый вариант продукта, который видит этот человек, или `null`, если продажи нет. */
  readonly offer: PriceSnapshot | null;
  readonly ownership: ProductOwnership;
  readonly signedIn: boolean;
  readonly slug: string;
}): CohortCall {
  const programme = guideProgrammeHref(slug);
  const openProgramme = {
    kind: "programme",
    href: programme,
    label: "Открыть программу",
  } as const;
  if (cohort === null)
    return { banner: null, action: openProgramme, compactOnPhone: true };

  const date =
    cohort.startsOn === null ? "" : formatCohortDate(cohort.startsOn);
  const payable = offer !== null && ownership !== "holds";
  const pay = (label: string) =>
    payable
      ? ({ kind: "purchase", href: guidePurchaseHref(slug), label } as const)
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
    case "preorder":
      return {
        banner: {
          label,
          text: `Предзаказ открыт до ${date}`,
          detail:
            "Сообщество и все опубликованные главы сразу после оплаты. Следующие главы выходят со старта потока по порядку программы, без фиксированных дат. После старта цена вырастет",
        },
        action: pay(`Оплатить ${price}`),
        compactOnPhone: false,
      };
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
          detail:
            "Проходи в своём темпе, автор сопровождает тебя 6 месяцев после покупки",
        },
        action: pay("Оплатить"),
        compactOnPhone: false,
      };
  }
}
