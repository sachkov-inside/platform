import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type {
  OwnerOperation,
  OwnerResult,
} from "../../domain/owner-operations.js";

/** Список скидок владельца: право `billing:manage` проверяет `BillingOperations`. */
export function listPromotions(
  _prisma: BillingPrismaClient,
  command: Extract<OwnerOperation, { operation: "promotions.list" }>,
): Promise<OwnerResult> {
  return Promise.resolve({
    ok: true,
    operationRef: command.operationId,
    result: { outcome: "promotions", items: [], nextCursor: null },
  });
}
