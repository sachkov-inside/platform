import {
  oneTimePriceShares,
  oneTimePurchaseTerms,
} from "@inside/legal/purchase-terms";

import {
  formatKopecks,
  formatMonths,
  formatYears,
  offerCompositionLabel,
  type PriceSnapshot,
} from "@/entities/subscription";

/**
 * Одна строка состава покупки. `kind` называет, о чём она — состав, срок материалов и чата или
 * сопровождение, — и по нему панель выбирает значок. Разбирать для этого подпись было бы гаданием.
 */
export interface CheckoutInclusion {
  readonly kind: "composition" | "materials" | "support";
  readonly caption: string;
  readonly title: string;
  readonly detail?: string;
}

// Сроки называет действующая оферта: `@inside/legal` сверяет их с её текстом.
const accessTerm = formatYears(oneTimePurchaseTerms.materialsAndChatYears);
const supportTerm = formatMonths(oneTimePurchaseTerms.supportMonths);

/**
 * Короткая сводка условий над согласием. Слова утверждены владельцем вместе с офертой (Workspace
 * #189); сводка не добавляет обещаний сверх оферты и не заменяет её текст.
 */
export const oneTimeTermsSummary: readonly string[] = [
  `Материалы и чат — ${accessTerm} гарантированно, дальше без гарантии срока.`,
  `Сопровождение — ${supportTerm}: ответы и помощь в общем чате. Личные встречи, гарантированный срок ответа и обязательная проверка кода не входят.`,
  "Отказ до открытия доступа — полный возврат. Позже — за вычетом истекшего времени, но не меньше положенного по закону.",
  "После отказа доступ по этой покупке закрывается.",
  "Если с нашей стороны есть недостатки или нарушения, действуют правила закона. При наличии оснований возвращается вся сумма.",
];

/** Распределение цены до оплаты: по нему оферта считает возврат при отказе. */
export function oneTimePriceSharesLine(totalKopecks: number): string {
  const shares = oneTimePriceShares(totalKopecks);
  return `Из них поровну: материалы и чат — ${formatKopecks(shares.materialsAndChatKopecks)}, сопровождение — ${formatKopecks(shares.supportKopecks)}`;
}

/**
 * Что получает покупатель: состав — из предложения, сроки — из оферты. Право на продукт выдаётся
 * без даты окончания, поэтому договорный срок из прав не выводится.
 */
export function oneTimePurchaseInclusions(
  snapshot: PriceSnapshot,
): readonly CheckoutInclusion[] {
  return [
    {
      kind: "composition",
      caption: "Состав",
      title: offerCompositionLabel(snapshot.offer),
      detail: snapshot.offer.name,
    },
    {
      kind: "materials",
      caption: "Материалы и общий чат",
      title: `${accessTerm} гарантированно`,
      detail: "дальше без гарантии срока",
    },
    { kind: "support", caption: "Сопровождение автора", title: supportTerm },
  ];
}
