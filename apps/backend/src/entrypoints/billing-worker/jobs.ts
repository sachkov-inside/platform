import type {
  BillingOperations,
  BillingPayments,
} from "../../modules/billing/index.js";

/** Обе сверки делят один `budget`: новая строка начинается, только пока он не прерван (#1929). */
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
  // кабинет банка (#1420), поэтому Cancel для возврата она не шлёт.
  const refunds = await operations.reconcileRefunds(limit, budget);
  if (result.value.failed > 0 || refunds.failed > 0)
    throw new Error("provider_unavailable");
  return { ...result.value, refunds };
}
