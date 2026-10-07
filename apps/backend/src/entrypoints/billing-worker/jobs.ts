import type {
  BillingPayments,
  BillingSubscriptions,
  BillingOperations,
  BillingNotices,
} from "../../modules/billing/index.js";

/** Обработчики очередей: простой — отчёт, неуспешный результат — сбой задания. */
export async function runRenewalJob(
  payments: Pick<BillingPayments, "renew">,
  subscriptions: Pick<BillingSubscriptions, "reconcileMethodFlows">,
  limit = 20,
) {
  const renewed = await payments.renew(limit);
  if (!renewed.ok) throw new Error(renewed.error.code);
  const bindings = await subscriptions.reconcileMethodFlows(limit);
  if (!bindings.ok) throw new Error(bindings.error.code);
  return { ...renewed.value, bindings: bindings.value };
}

export async function runRecoveryJob(
  payments: Pick<BillingPayments, "recover">,
  operations: Pick<BillingOperations, "reconcileRefunds">,
  limit = 20,
) {
  const result = await payments.recover(limit);
  if (!result.ok) throw new Error(result.error.code);
  // Сверка сохраняет ExternalRequestId и не создаёт новую попытку возврата.
  const refunds = await operations.reconcileRefunds(limit);
  return { ...result.value, refunds };
}

export async function runNoticeJob(
  notices: Pick<BillingNotices, "scheduleReminders">,
  limit = 20,
) {
  const result = await notices.scheduleReminders(limit);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
