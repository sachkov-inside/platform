import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { Accounts } from "../../../accounts/index.js";
import { manageCatalog } from "../../features/manage-catalog/manage-catalog.js";
import { quotePurchase } from "../../features/quote-purchase/quote-purchase.js";
import { listOffers } from "../../features/list-offers/list-offers.js";
import { reservePurchase, type ReservePurchase } from "../../features/reserve-purchase/reserve-purchase.js";
import { settleReservation, type SettleReservation } from "../../features/settle-reservation/settle-reservation.js";

export class BillingPricing {
  private readonly clock: () => Date;
  constructor(private readonly dependencies: { prisma: BillingPrismaClient; accounts: Pick<Accounts, "checkPermission">; clock?: () => Date }) {
    this.clock = dependencies.clock ?? (() => new Date());
  }
  manage(actor: string, input: unknown) { return manageCatalog(this.dependencies, actor, input); }
  offers(input: unknown) { return listOffers(this.dependencies.prisma, input, this.clock); }
  quote(accountId: string, input: unknown) { return quotePurchase(this.dependencies.prisma, accountId, input, this.clock); }
  reserve(input: ReservePurchase) { return reservePurchase(this.dependencies.prisma, input, this.clock); }
  settle(input: SettleReservation) { return settleReservation(this.dependencies.prisma, input); }
}
