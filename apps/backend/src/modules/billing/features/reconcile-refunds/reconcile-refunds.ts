import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { BillingPayments } from "../../facets/billing-payments/billing-payments.js";
import type { Tbank } from "../../infrastructure/tbank/tbank.js";
import { unsettledRefundStates } from "../../shared/refund-amounts.js";

/** Сверка исторических незавершённых возвратов. Никогда не вызывает Cancel. */
export async function reconcileRefunds(
  dependencies: {
    readonly prisma: BillingPrismaClient;
    readonly bank: Tbank | undefined;
    readonly payments: Pick<BillingPayments, "reconcile">;
  },
  limit = 50,
): Promise<{
  readonly status: "ready" | "configuration_idle";
  readonly inspected: number;
  readonly settled: number;
  readonly failed: number;
}> {
  const { prisma, bank, payments } = dependencies;
  if (bank === undefined)
    return {
      status: "configuration_idle",
      inspected: 0,
      settled: 0,
      failed: 0,
    };
  const rows = await prisma.billingRefund.findMany({
    where: {
      state: { in: unsettledRefundStates },
      environment: bank.config.environment,
      terminalRef: bank.config.terminalKey,
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let settled = 0,
    failed = 0;
  for (const row of rows) {
    const result = await payments.reconcile(row.purchaseRef);
    if (!result.ok) {
      failed += 1;
      continue;
    }
    const current = await prisma.billingRefund.findUniqueOrThrow({
      where: { id: row.id },
    });
    if (current.state === "confirmed" || current.state === "failed")
      settled += 1;
  }
  return { status: "ready", inspected: rows.length, settled, failed };
}
