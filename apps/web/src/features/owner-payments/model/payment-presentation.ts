import { adminStates, type AdminStateKey } from "@/shared/ui/admin";
import { formatRubles } from "@/shared/lib/moscow-format";

import type {
  PaymentAccess,
  PaymentView,
  RefundDecisionView,
} from "./payment-contract";
import type { PaymentState } from "./payment-filters";

/** Плашка банковского состояния: неизвестное банку остаётся «нужна сверка», а не успехом. */
export function paymentStateBadge(state: PaymentState): AdminStateKey {
  return `payment.${state}`;
}

/** Плашка готовности доступа: она отдельна от банковского состояния и от чека. */
export function paymentAccessBadge(access: PaymentAccess): AdminStateKey {
  return `payment.access.${access}`;
}

/** Подпись состояния в фильтре: слово плашки из общего словаря админки. */
export const paymentStateLabels: Readonly<Record<PaymentState, string>> = {
  prepared: stateLabel("prepared"),
  sent: stateLabel("sent"),
  pending: stateLabel("pending"),
  authorized: stateLabel("authorized"),
  confirmed: stateLabel("confirmed"),
  failed: stateLabel("failed"),
  unknown: stateLabel("unknown"),
};

function stateLabel(state: PaymentState): string {
  return adminStates[paymentStateBadge(state)].label;
}

/**
 * Название продукта из оплаченных условий. Прежние покупки без продукта в снимке называются
 * предложением, которое человек оплатил.
 */
export function paymentProductName(payment: PaymentView): string {
  return payment.snapshot.product?.name ?? payment.snapshot.offer.name;
}

/** Сумма или честное «уточняется»: `null` значит, что банк ещё не подтвердил итог возвратов. */
export function refundAmountText(kopecks: number | null): string {
  return kopecks === null ? "Уточняется в банке" : formatRubles(kopecks);
}

export const paymentKindLabels: Readonly<Record<PaymentView["kind"], string>> =
  {
    initial: "Первая покупка",
    one_time: "Разовая покупка",
    renewal: "Продление",
    upgrade: "Смена условий",
  };

export const fiscalizationLabels: Readonly<
  Record<PaymentView["fiscalization"], string>
> = {
  not_configured: "Чеки не настроены",
  pending: "Чек формируется",
  confirmed: "Чек выдан",
  failed: "Чек не выдан",
};

export const environmentLabels: Readonly<
  Record<PaymentView["environment"], string>
> = {
  production: "Боевой терминал",
  demo: "Тестовый терминал",
  local: "Локальный стенд",
};

/** Событие банка словами владельца; незнакомое событие называется своим кодом, а не скрывается. */
export function paymentEventLabel(kind: string): string {
  if (kind.startsWith("partial_refund_observed:"))
    return "Банк сообщил о частичном возврате, сумму нужно проверить";
  const labels: Readonly<Record<string, string>> = {
    payment_confirmed: "Банк подтвердил оплату",
    fulfillment_review_required: "Выдача доступа ждёт проверки",
    fiscalization_confirmed: "Чек выдан",
    fiscalization_failed: "Чек не выдан",
    full_refund_confirmed: "Банк подтвердил полный возврат",
    legacy_dispatch_retired: "Прежняя попытка закрыта без отправки в банк",
    payment_confirmed_after_failure:
      "Банк подтвердил оплату после отказа по той же форме",
    superseded_by_confirmed_payment:
      "Попытка закрыта: оплачена прежняя попытка этой покупки",
    duplicate_payment_review:
      "Продукт оплачен второй раз, нужно решение о возврате",
    bank_cancel_requested:
      "Попытка снята, сверка закроет её форму оплаты в банке",
    bank_cancel_confirmed: "Банк закрыл форму оплаты снятой попытки",
    bank_cancel_returned_payment:
      "Покупатель успел оплатить снятую попытку, отмена вернула деньги",
    partial_refund_released:
      "Частичный возврат без подтверждённой оплаты: покупка закрыта, нужно решение о деньгах",
  };
  return labels[kind] ?? `Событие ${kind}`;
}

/** Команда владельца из журнала; незнакомая называется своим кодом. */
export function auditOperationLabel(operation: string): string {
  const labels: Readonly<Record<string, string>> = {
    "payments.reconcile": "Сверка с банком",
    "refunds.decide": "Решение о возврате",
    "refunds.execute": "Возврат отправлен в банк",
    "refunds.reconcile": "Сверка возврата с банком",
  };
  return labels[operation] ?? `Операция ${operation}`;
}

export const refundBasisLabels: Readonly<
  Record<NonNullable<RefundDecisionView["basis"]>, string>
> = {
  withdrawal: "Отказ от договора",
  compensation: "Компенсация без отказа",
};

export const refundDecisionStateLabels: Readonly<
  Record<RefundDecisionView["state"], string>
> = {
  decided: "Решение принято",
  executing: "Возврат выполняется",
  executed: "Возврат выполнен",
  failed: "Возврат не прошёл",
};

export const refundAttemptStateLabels: Readonly<
  Record<NonNullable<RefundDecisionView["attempt"]>["state"], string>
> = {
  sent: "Отправлен в банк",
  unknown: "Банк не ответил, нужна сверка",
  confirmed: "Банк подтвердил",
  failed: "Банк отклонил",
};

/** Что будет с доступом и продлением после возврата. */
export function refundConsequenceText(decision: RefundDecisionView): string {
  const access =
    decision.access === "revoke" ? "доступ отзывается" : "доступ сохраняется";
  const recurring =
    decision.recurring === "cancel"
      ? "продление отменяется"
      : "продление не меняется";
  return `${access}, ${recurring}`;
}
