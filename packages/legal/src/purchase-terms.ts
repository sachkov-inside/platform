/**
 * Условия разовой покупки, которые покупатель видит до оплаты рядом с согласием и которые задаёт
 * сам текст действующей оферты: расчётный срок части цены без срока окончания, окно полного
 * возврата и распределение цены. Сроки материалов, чата и сопровождения здесь не живут: с
 * редакции 5 их задаёт предложение продукта, и оплата читает их из его снимка. Тест пакета сверяет
 * эти числа с текстом оферты и с номером редакции, поэтому новая редакция не пройдёт, пока их не
 * сверили.
 *
 * Модуль не тянет сами редакции: его читает браузер на странице оплаты.
 *
 * Тест сверяет только числа. Новая редакция оферты требует ручной сверки того, что стоит рядом:
 * сводки условий и доли цены на оплате (`apps/web/src/features/billing-checkout/model/one-time-terms.ts`)
 * и описаний в `docs/product/platform-mvp-brief.md` и `docs/specifications/platform-v1.md`.
 */
export const oneTimePurchaseTerms = {
  /** Редакция оферты `purchase`, которой принадлежат эти условия. */
  edition: 5,
  /**
   * Расчётный срок: на него распределяется часть цены «материалы и общий чат», когда срок
   * материалов или чата в предложении не ограничен. Доступ он не ограничивает.
   */
  unlimitedPartRefundMonths: 12,
  /** Отказ в эти дни после дня оплаты возвращает всю сумму, даже когда доступ открыт. */
  fullRefundDays: 7,
} as const;

/** Цена, распределённая до оплаты между двумя частями, как её сохраняет и считает оферта. */
export interface OneTimePriceShares {
  readonly materialsAndChatKopecks: number;
  readonly supportKopecks: number;
}

/**
 * Поровну. Нечётная копейка остаётся в части «материалы и общий чат»: она уменьшается медленнее
 * сопровождения, поэтому округление не уменьшает возврат покупателю. Сумма частей равна цене.
 * У предложения без сопровождения оферта относит всю цену к материалам и чату: для него эта
 * функция не вызывается.
 */
export function oneTimePriceShares(totalKopecks: number): OneTimePriceShares {
  if (!Number.isSafeInteger(totalKopecks) || totalKopecks < 0)
    throw new Error(
      `Price must be a whole non-negative number of kopecks, received: ${String(totalKopecks)}`,
    );
  const supportKopecks = Math.floor(totalKopecks / 2);
  return {
    materialsAndChatKopecks: totalKopecks - supportKopecks,
    supportKopecks,
  };
}
