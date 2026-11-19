import type { BillingPrisma } from "../../../infrastructure/prisma/index.js";

/**
 * Попытка возврата, чей результат ещё не доказан: она удерживает свою сумму, сверяется тем же
 * запросом и не отправляется заново.
 */
export const unsettledRefundStates = ["sent", "unknown"];

export interface RefundTotals {
  readonly refundedKopecks: number;
  readonly heldKopecks: number;
  readonly refundableKopecks: number;
}
export interface RefundAmountRow {
  readonly state: string;
  readonly amountKopecks: bigint;
}

/** Остаток к возврату по одному платежу из его попыток. */
export function refundTotalsOf(
  rows: readonly RefundAmountRow[],
  amountKopecks: bigint,
): RefundTotals {
  const sum = (states: readonly string[]) =>
    rows
      .filter((row) => states.includes(row.state))
      .reduce((total, row) => total + row.amountKopecks, 0n);
  const refunded = sum(["confirmed"]);
  const held = sum(unsettledRefundStates);
  return {
    refundedKopecks: Number(refunded),
    heldKopecks: Number(held),
    refundableKopecks: Number(amountKopecks - refunded - held),
  };
}

/** Суммы для владельца: до подтверждения оплаты возвращать нечего. */
export function ownerRefundAmounts(
  purchase: { state: string; refundReviewRequired: boolean },
  totals: RefundTotals,
) {
  if (purchase.refundReviewRequired)
    return { refundedKopecks: null, refundableKopecks: null };
  return {
    refundedKopecks: totals.refundedKopecks,
    refundableKopecks:
      purchase.state === "confirmed" ? totals.refundableKopecks : 0,
  };
}

/** Тот же остаток, прочитанный под замком платежа перед решением и отправкой. */
export async function refundTotals(
  tx: BillingPrisma,
  purchaseRef: string,
  amountKopecks: bigint,
): Promise<RefundTotals> {
  const rows = await tx.billingRefund.findMany({
    where: { purchaseRef },
    select: { state: true, amountKopecks: true },
  });
  return refundTotalsOf(rows, amountKopecks);
}
