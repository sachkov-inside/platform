import {
  oneTimePriceShares,
  oneTimePurchaseTerms,
} from "@inside/legal/purchase-terms";

import { fillOfferTerms, type OfferTerms } from "@/entities/product-page";
import {
  formatKopecks,
  formatMonths,
  formatTermMonths,
  longestTerm,
  offerCompositionLabel,
  type PriceSnapshot,
} from "@/entities/subscription";

/**
 * Одна строка состава покупки. `kind` называет, о чём она — состав, срок материалов, чата или
 * сопровождение, — и по нему панель выбирает значок. Разбирать для этого подпись было бы гаданием.
 */
export interface CheckoutInclusion {
  readonly kind: "composition" | "materials" | "chat" | "support";
  readonly caption: string;
  readonly title: string;
  readonly detail?: string;
}

export {
  oneTimeOfferTerms,
  type OneTimeOfferTerms,
} from "@/entities/subscription.terms";
import {
  oneTimeOfferTerms,
  type OneTimeOfferTerms,
} from "@/entities/subscription.terms";

const unlimitedTerm = "без ограничения срока";

/**
 * Расчётный срок части цены «материалы и общий чат», когда материалы или чат даны без ограничения
 * срока: 12 месяцев из оферты, но не короче срока другой составляющей, названного в месяцах
 * (оферта, раздел 4).
 */
function calculationTerm(terms: OneTimeOfferTerms): string {
  return formatMonths(
    Math.max(
      oneTimePurchaseTerms.unlimitedPartRefundMonths,
      terms.materialsMonths ?? 0,
      terms.chatMonths ?? 0,
    ),
  );
}
const supportNotIncluded = "не входит в покупку";

/** Срок словами: «2 года», «6 месяцев», «без ограничения срока». */
function termLabel(months: number | null): string {
  return months === null ? unlimitedTerm : formatTermMonths(months);
}

/**
 * Подписи сроков для авторского текста описания продукта: срок доступа — срок материалов, как его
 * гарантирует оферта; чат со своим сроком называет страница оплаты.
 */
export function oneTimeTermLabels(terms: OneTimeOfferTerms): OfferTerms {
  return {
    access: termLabel(terms.materialsMonths),
    support:
      terms.supportMonths === undefined
        ? supportNotIncluded
        : termLabel(terms.supportMonths),
  };
}

/**
 * Подписи для страницы, у продукта которой сейчас нет предложения в продаже: срок назвать нечем,
 * а выдумывать его страница не должна.
 */
const termsWithoutOffer: OfferTerms = {
  access: "по условиям предложения",
  support: "по условиям предложения",
};

/**
 * Подстановка сроков в авторский текст описания продукта: автор пишет `{access_term}` и
 * `{support_term}`, а подписи даёт предложение этого продукта, поэтому страница не заводит своих
 * чисел. `null` — предложения в продаже нет.
 */
export function fillOneTimeTerms(
  text: string,
  terms: OneTimeOfferTerms | null,
): string {
  return fillOfferTerms(
    text,
    terms === null ? termsWithoutOffer : oneTimeTermLabels(terms),
  );
}

/** Срок в месяцах гарантированный; без ограничения — без даты окончания (оферта, раздел 4). */
function guaranteedTermLine(subject: string, months: number | null): string {
  return months === null
    ? `${subject} — ${unlimitedTerm}.`
    : `${subject} — ${formatTermMonths(months)} гарантированно, дальше без гарантии срока.`;
}

/**
 * Короткая сводка условий над согласием. Сроки — из предложения, остальное повторяет оферту:
 * сводка не добавляет обещаний сверх неё и не заменяет её текст.
 */
export function oneTimeTermsSummary(
  terms: OneTimeOfferTerms,
): readonly string[] {
  const sameTerm = terms.materialsMonths === terms.chatMonths;
  // У части цены без срока окончания оферта считает возврат по расчётному сроку (раздел 4).
  const elapsed =
    longestTerm([terms.materialsMonths, terms.chatMonths]) !== null
      ? "за вычетом истекшего времени"
      : terms.supportMonths === undefined
        ? `за вычетом истекшего времени из расчётного срока ${calculationTerm(terms)}`
        : `за вычетом истекшего времени: сопровождение — из его срока, материалы и чат — из расчётного срока ${calculationTerm(terms)}`;
  return [
    ...(sameTerm
      ? [guaranteedTermLine("Материалы и чат", terms.materialsMonths)]
      : [
          guaranteedTermLine("Материалы", terms.materialsMonths),
          guaranteedTermLine("Общий чат", terms.chatMonths),
        ]),
    ...(terms.supportMonths === undefined
      ? []
      : [
          `Сопровождение — ${termLabel(terms.supportMonths)}: ответы и помощь в общем чате. Личные встречи, гарантированный срок ответа и обязательная проверка кода не входят.`,
        ]),
    `Отказ в первые ${String(oneTimePurchaseTerms.fullRefundDays)} дней или до открытия доступа — полный возврат. Позже — ${elapsed}, но не меньше положенного по закону.`,
    "После отказа доступ по этой покупке закрывается.",
    "Если с нашей стороны есть недостатки или нарушения, действуют правила закона. При наличии оснований возвращается вся сумма.",
  ];
}

/**
 * Распределение цены до оплаты: по нему оферта считает возврат при отказе. У предложения без
 * сопровождения вся цена относится к материалам и чату — строка так и говорит.
 */
export function oneTimePriceSharesLine(
  totalKopecks: number,
  terms: OneTimeOfferTerms,
): string {
  if (terms.supportMonths === undefined)
    return "Вся цена относится к материалам и чату";
  const shares = oneTimePriceShares(totalKopecks);
  return `Из них поровну: материалы и чат — ${formatKopecks(shares.materialsAndChatKopecks)}, сопровождение — ${formatKopecks(shares.supportKopecks)}`;
}

function termInclusion(
  kind: "materials" | "chat",
  caption: string,
  months: number | null,
): CheckoutInclusion {
  return months === null
    ? { kind, caption, title: "Без ограничения срока" }
    : {
        kind,
        caption,
        title: `${formatTermMonths(months)} гарантированно`,
        detail: "дальше без гарантии срока",
      };
}

/** Что получает покупатель: состав и сроки — из снимка предложения, которое он оплачивает. */
export function oneTimePurchaseInclusions(
  snapshot: PriceSnapshot,
): readonly CheckoutInclusion[] {
  const terms = oneTimeOfferTerms(snapshot);
  return [
    {
      kind: "composition",
      caption: "Состав",
      title: offerCompositionLabel(snapshot.offer),
      detail: snapshot.offer.name,
    },
    ...(terms.materialsMonths === terms.chatMonths
      ? [
          termInclusion(
            "materials",
            "Материалы и общий чат",
            terms.materialsMonths,
          ),
        ]
      : [
          termInclusion("materials", "Материалы", terms.materialsMonths),
          termInclusion("chat", "Общий чат", terms.chatMonths),
        ]),
    ...(terms.supportMonths === undefined
      ? []
      : [
          {
            kind: "support" as const,
            caption: "Сопровождение автора",
            title:
              terms.supportMonths === null
                ? "Без ограничения срока"
                : formatTermMonths(terms.supportMonths),
          },
        ]),
  ];
}
