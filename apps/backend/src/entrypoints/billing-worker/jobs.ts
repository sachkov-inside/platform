import {
  recoveryItemMilliseconds,
  type BillingOperations,
  type BillingPayments,
} from "../../modules/billing/index.js";

/**
 * Бюджет прохода сверки меньше срока задания на две самые долгие строки: одну, начатую в последний
 * миг бюджета, и одну в запас на работу с базой после запросов к банку (#1929).
 */
export function recoveryBudgetMilliseconds(
  jobDeadlineMilliseconds: number,
): number {
  return jobDeadlineMilliseconds - 2 * recoveryItemMilliseconds;
}

export async function runRecoveryJob(
  payments: Pick<BillingPayments, "recover">,
  operations: Pick<BillingOperations, "reconcileRefunds">,
  budget: AbortSignal,
  limit = 20,
) {
  // Сверка платежей шлёт Cancel только для неоплаченной формы снятой попытки (#1923).
  const result = await payments.recover(limit, budget);
  if (!result.ok) throw new Error(result.error.code);
  // Сверка возвратов читает состояние платежа. Возврат оплаченного платежа идёт только через
  // кабинет банка (#1420), поэтому Cancel для возврата она не шлёт. Бюджет у обеих сверок общий.
  const refunds = await operations.reconcileRefunds(limit, budget);
  if (result.value.failed > 0 || refunds.failed > 0)
    throw new Error("provider_unavailable");
  return { ...result.value, refunds };
}
