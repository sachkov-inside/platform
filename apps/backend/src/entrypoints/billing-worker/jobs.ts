import type {
  BillingOperations,
  BillingPayments,
} from "../../modules/billing/index.js";

export async function runRecoveryJob(
  payments: Pick<BillingPayments, "recover">,
  operations: Pick<BillingOperations, "reconcileRefunds">,
  limit = 20,
) {
  const result = await payments.recover(limit);
  if (!result.ok) throw new Error(result.error.code);
  // Сверка читает состояние платежа; банковский Cancel запрещён политикой #1420.
  const refunds = await operations.reconcileRefunds(limit);
  if (result.value.failed > 0 || refunds.failed > 0)
    throw new Error("provider_unavailable");
  return { ...result.value, refunds };
}
