import type { DailyWindow } from "../../../../infrastructure/contracts/daily-window.js";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import {
  countAttention,
  listRecentPayments,
  readDailySales,
} from "../../features/read-sales-overview/read-sales-overview.js";

/**
 * Sales aggregates of the admin Overview (#1719): daily sales and net revenue, the payments that
 * need the owner, and the latest confirmed payments. Internal reads without an actor: the
 * composing read checks `billing:manage` first. `productId` narrows every read to the Product of
 * the paid snapshot, as `payments.list` does.
 */
export class BillingSalesOverview {
  constructor(private readonly prisma: BillingPrismaClient) {}

  readDailySales(window: DailyWindow, productId?: string) {
    return readDailySales(this.prisma, window, productId);
  }

  countAttention() {
    return countAttention(this.prisma);
  }

  listRecentPayments(limit: number, productId?: string) {
    return listRecentPayments(this.prisma, limit, productId);
  }
}
