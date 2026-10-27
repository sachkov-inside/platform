import type { Route } from "next";

import type { AdminStateKey } from "@/shared/ui/admin";
import { formatRubles } from "@/shared/lib/moscow-format";
import { authoringPaymentHref } from "@/shared/routing/authoring";
import { internalRoute } from "@/shared/routing/internal-route";

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

/** Подпись состояния в фильтре и плашках: то же слово, что в общем словаре. */
export const paymentStateLabels: Readonly<Record<PaymentState, string>> = {
  prepared: "Подготовлен",
  sent: "Отправлен в банк",
  pending: "Ждёт оплаты",
  authorized: "Деньги заблокированы",
  confirmed: "Оплачен",
  failed: "Не прошёл",
  unknown: "Неизвестно, нужна сверка",
};

/**
 * «Ссылки на оплату»: страницу строит соседняя задача #1718, и пока её маршрута нет в дереве,
 * типизированные адреса Next его не знают.
 */
export const paymentLinksHref: Route = internalRoute("/authoring/sales/links");

/** Адрес страницы платежа. */
export const salesPaymentHref = authoringPaymentHref;

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
