/**
 * Имена событий покупки в `billing.payment_events`. Их пишет сверка и приём ответов банка, а
 * читают фильтр проверки владельца и сторож production. Сторож хранит имена в своём SQL;
 * `watchdog-payment-signals.test.ts` сверяет этот SQL с перечнями ниже.
 */
export const paymentEventKind = {
  paymentConfirmed: "payment_confirmed",
  /** Банк подтвердил оплату попытки, которую Inside уже считала неуспешной. */
  paymentConfirmedAfterFailure: "payment_confirmed_after_failure",
  /**
   * Частичный возврат доказал списание неподтверждённой покупки: покупка подтверждена, а сумму
   * возврата проверяет владелец.
   */
  paymentConfirmedByPartialRefund: "payment_confirmed_by_partial_refund",
  duplicatePaymentReview: "duplicate_payment_review",
  fulfillmentReviewRequired: "fulfillment_review_required",
  fullRefundConfirmed: "full_refund_confirmed",
  /** Покупка снята до Init; причина лежит в `payload.reason`. */
  dispatchRetired: "dispatch_retired",
  /** Попытка снята: оплачена другая попытка того же продукта или той же ссылки. */
  supersededByConfirmedPayment: "superseded_by_confirmed_payment",
  /** Попытка снята покупкой по другой цене (#1925). */
  replacedByNewPrice: "replaced_by_new_price",
  /** Попытка снята без адреса формы оплаты (#1926). */
  formAddressLost: "form_address_lost",
  /** Неподтверждённая покупка с частичной отменой холда закрыта до решения владельца (#1929). */
  partialRefundReleased: "partial_refund_released",
  /** Форму снятой попытки нужно отменить в банке (#1923). */
  bankCancelRequested: "bank_cancel_requested",
  /** Банк закрыл форму снятой попытки: Cancel или собственным статусом. */
  bankCancelConfirmed: "bank_cancel_confirmed",
  /** Cancel опоздал: покупатель успел оплатить форму, и банк вернул деньги. */
  bankCancelReturnedPayment: "bank_cancel_returned_payment",
  /** В банке нет платежа попытки (#1922); причина лежит в `payload.reason`. */
  bankPaymentAbsent: "bank_payment_absent",
  /** Первый пустой ответ CheckOrder: от него идёт окно отсутствия платежа. */
  bankOrderEmpty: "bank_order_empty",
  bankStatusUnrecognized: "bank_status_unrecognized",
} as const;

/**
 * Начало имени события `PARTIAL_REFUNDED` или `PARTIAL_REVERSED`: за ним идёт хеш наблюдения, и
 * каждое отличное наблюдение пишется своим событием. Amount такого события не равен сумме возврата.
 */
export const partialRefundObservedKindPrefix = "partial_refund_observed:";

/**
 * События для проверки владельцем (#1921, инвариант 4): вторая оплата, подтверждение после отказа
 * или частичным возвратом, каждое автоматическое снятие попытки, покупка без платежа в банке,
 * частичная отмена без подтверждённой оплаты и деньги, которые вернул опоздавший Cancel. Фильтр
 * `events: "review"` выбирает покупки с ними или с открытой отменой в банке. Сторож поднимает по
 * сигналу на каждый вид.
 */
export const reviewPaymentEventKinds = [
  paymentEventKind.duplicatePaymentReview,
  paymentEventKind.paymentConfirmedAfterFailure,
  paymentEventKind.paymentConfirmedByPartialRefund,
  paymentEventKind.supersededByConfirmedPayment,
  paymentEventKind.replacedByNewPrice,
  paymentEventKind.formAddressLost,
  paymentEventKind.dispatchRetired,
  paymentEventKind.bankPaymentAbsent,
  paymentEventKind.partialRefundReleased,
  paymentEventKind.bankCancelReturnedPayment,
] as const;

/**
 * События, которые закрывают отметку отмены: форма закрыта или платежа в банке нет, и отменять
 * нечего. Подтверждённая оплата тоже закрывает отметку: она пишет `bank_cancel_confirmed`.
 */
export const bankCancelClosingEventKinds = [
  paymentEventKind.bankCancelConfirmed,
  paymentEventKind.bankPaymentAbsent,
] as const;

/**
 * Открытая отмена в банке: у покупки есть `bank_cancel_requested` и нет ни одного события из
 * `bankCancelClosingEventKinds`. Это единственное определение; SQL того же правила строит
 * `shared/open-bank-cancel.ts`, а сторож production повторяет его и сверяется тестом.
 */
export function isBankCancelOpen(eventKinds: readonly string[]): boolean {
  return (
    eventKinds.includes(paymentEventKind.bankCancelRequested) &&
    !eventKinds.some((kind) =>
      (bankCancelClosingEventKinds as readonly string[]).includes(kind),
    )
  );
}
