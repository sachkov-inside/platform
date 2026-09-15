/**
 * Условия разовой покупки, которые покупатель видит до оплаты рядом с согласием: сроки составляющих
 * и распределение цены из действующей оферты. Источник — текст самой оферты; тест пакета сверяет эти
 * числа с ним и с номером редакции, поэтому новая редакция не пройдёт, пока их не сверили.
 *
 * Модуль не тянет сами редакции: его читает браузер на странице оплаты.
 */
export const oneTimePurchaseTerms = {
  /** Редакция оферты `purchase`, которой принадлежат эти условия. */
  edition: 3,
  /** Гарантированный срок материалов и общего чата; после него доступ может сохраняться без гарантии. */
  materialsAndChatYears: 2,
  /** Сопровождение автора с подтверждения оплаты. */
  supportMonths: 6,
} as const;

/** Цена, распределённая до оплаты между двумя частями, как её сохраняет и считает оферта. */
export interface OneTimePriceShares {
  readonly materialsAndChatKopecks: number;
  readonly supportKopecks: number;
}

/**
 * Поровну. Нечётная копейка остаётся в части «материалы и общий чат»: она уменьшается медленнее
 * сопровождения, поэтому округление не уменьшает возврат покупателю. Сумма частей равна цене.
 */
export function oneTimePriceShares(totalKopecks: number): OneTimePriceShares {
  if (!Number.isSafeInteger(totalKopecks) || totalKopecks < 0)
    throw new Error(
      `Price must be a whole non-negative number of kopecks, received: ${String(totalKopecks)}`,
    );
  const supportKopecks = Math.floor(totalKopecks / 2);
  return { materialsAndChatKopecks: totalKopecks - supportKopecks, supportKopecks };
}
