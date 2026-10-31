import { oneTimePriceShares } from "@inside/legal/purchase-terms";

import { fillOfferTerms, type OfferTerms } from "@/entities/product-page";
import {
  formatKopecks,
  formatTermMonths,
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

const supportNotIncluded = "не входит в покупку";

/** Срок словами: «2 года», «6 месяцев», «без ограничения срока». */
function termLabel(months: number | null): string {
  return months === null ? unlimitedTerm : formatTermMonths(months);
}

/**
 * Public copy names the access term, but leaves the author support duration in the offer document.
 */
export function oneTimeTermLabels(terms: OneTimeOfferTerms): OfferTerms {
  return {
    access: termLabel(terms.materialsMonths),
    support:
      terms.supportMonths === undefined
        ? supportNotIncluded
        : "по условиям оферты",
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
 * Resolve authored placeholders without promoting the legal support duration on the page.
 * `null` means that the Product has no current offer.
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
 * Короткая сводка условий над согласием: только то, что оферта велит показать до оплаты (сроки
 * доступа и условие сопровождения). Отказ и возврат описывает сама оферта по ссылке рядом
 * (решение владельца 31.10.2026).
 */
export function oneTimeTermsSummary(
  terms: OneTimeOfferTerms,
): readonly string[] {
  const sameTerm = terms.materialsMonths === terms.chatMonths;
  return [
    ...(sameTerm
      ? [
          guaranteedTermLine(
            "Материалы и сообщество продукта",
            terms.materialsMonths,
          ),
        ]
      : [
          guaranteedTermLine("Материалы", terms.materialsMonths),
          ...(terms.chatMonths === undefined
            ? []
            : [guaranteedTermLine("Сообщество продукта", terms.chatMonths)]),
        ]),
    ...(terms.supportMonths === undefined
      ? []
      : ["Сопровождение автора по условиям оферты."]),
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
    return terms.chatMonths === undefined
      ? "Вся цена относится к материалам"
      : "Вся цена относится к материалам и сообществу продукта";
  const shares = oneTimePriceShares(totalKopecks);
  return `Из них поровну: ${terms.chatMonths === undefined ? "материалы" : "материалы и сообщество продукта"} — ${formatKopecks(shares.materialsAndChatKopecks)}, сопровождение — ${formatKopecks(shares.supportKopecks)}`;
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
            "Материалы и сообщество продукта",
            terms.materialsMonths,
          ),
        ]
      : [
          termInclusion("materials", "Материалы", terms.materialsMonths),
          ...(terms.chatMonths === undefined
            ? []
            : [termInclusion("chat", "Сообщество продукта", terms.chatMonths)]),
        ]),
    ...(terms.supportMonths === undefined
      ? []
      : [
          {
            kind: "support" as const,
            caption: "Сопровождение автора",
            title: "Ответы и помощь",
          },
        ]),
  ];
}
