import type { BillingPrisma } from "../../../infrastructure/prisma/index.js";

/**
 * Применения скидки для лимита использования: каждый резерв цены, кроме неудавшегося. Одно
 * правило для подбора цены, проверки нового лимита и списка владельца; один запрос на набор.
 */
export async function promotionUsage(
  tx: BillingPrisma,
  promotionIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (promotionIds.length === 0) return new Map();
  const counts = await tx.billingPromoReservation.groupBy({
    by: ["promotionId"],
    where: {
      promotionId: { in: [...promotionIds] },
      state: { not: "failed" },
    },
    _count: { _all: true },
  });
  return new Map(
    counts.flatMap((row) =>
      row.promotionId === null ? [] : [[row.promotionId, row._count._all]],
    ),
  );
}
