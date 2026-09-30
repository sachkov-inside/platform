import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { Accounts } from "../../../accounts/index.js";
import { manageCatalog } from "../../features/manage-catalog/manage-catalog.js";
import type { SaleCapability } from "../../domain/sale-capability.js";
import { quotePurchase } from "../../features/quote-purchase/quote-purchase.js";
import {
  assertSaleConfigured,
  type SalePaymentConfiguration,
} from "../../features/assert-sale-configured/assert-sale-configured.js";
import { listOffers } from "../../features/list-offers/list-offers.js";
import { listGuideCohorts } from "../../features/list-guide-cohorts/list-guide-cohorts.js";
import {
  reservePurchase,
  type ReservePurchase,
} from "../../features/reserve-purchase/reserve-purchase.js";
import {
  settleReservation,
  type SettleReservation,
} from "../../features/settle-reservation/settle-reservation.js";
import { sellsSubscription } from "../../shared/tier-composition.js";
import {
  noPurchaseGrounds,
  offerAdmits,
  readPurchaseGrounds,
  type PurchaseGroundsReader,
} from "../../shared/offer-eligibility.js";
import { failure, offerEligibilitySchema } from "../../domain/pricing.js";

export class BillingPricing {
  private readonly clock: () => Date;
  /** `sale` — что процесс вправе продавать; каталог не включает продажу сверх этого. */
  constructor(
    private readonly dependencies: {
      prisma: BillingPrismaClient;
      accounts: Pick<Accounts, "checkPermission">;
      clock?: () => Date;
      sale: SaleCapability;
      /** Основания Account для Offer с ограничением допуска; без них такие Offer не продаются. */
      grants?: PurchaseGroundsReader;
    },
  ) {
    this.clock = dependencies.clock ?? (() => new Date());
  }
  manage(actor: string, input: unknown) {
    return manageCatalog(this.dependencies, actor, input);
  }
  /**
   * Публичная витрина: только предложения, включённые в продажу и допускающие читателя. Гость и
   * Account, чьи основания прочитать не удалось, видят только Offer для всех.
   */
  async offers(input: unknown, accountId?: string) {
    const grounds = await readPurchaseGrounds(
      this.dependencies.grants,
      accountId,
    );
    return listOffers(this.dependencies.prisma, input, this.clock, {
      publishedOnly: true,
      grounds: grounds ?? noPurchaseGrounds,
    });
  }
  /** Текущие потоки продуктов: публичный факт, одинаковый для гостя, покупателя и владельца. */
  cohorts() {
    return listGuideCohorts(this.dependencies.prisma);
  }
  /** Владельческий каталог: весь неархивный каталог вместе с выключенными из продажи предложениями. */
  ownerCatalog(input: unknown) {
    return listOffers(this.dependencies.prisma, input, this.clock, {
      publishedOnly: false,
    });
  }
  /**
   * Подписка предлагается тогда, когда продаётся хотя бы один неархивный вариант подписки у тарифа
   * с составом, допускающего этот Account. Разовое предложение продукта этот признак не включает:
   * оно продаёт руководство. Гостю предлагается только подписка для всех.
   */
  async hasOffersForSale(accountId?: string): Promise<boolean> {
    const rows = (
      await this.dependencies.prisma.billingOffer.findMany({
        where: {
          archived: false,
          published: true,
          options: { some: { archived: false, mode: "subscription" } },
        },
        select: { benefits: true, contentScope: true, eligibility: true },
      })
    ).filter(sellsSubscription);
    const eligibilities = rows.map((row) =>
      offerEligibilitySchema.parse(row.eligibility),
    );
    if (eligibilities.includes("everyone")) return true;
    if (eligibilities.length === 0) return false;
    const grounds = await readPurchaseGrounds(
      this.dependencies.grants,
      accountId,
    );
    return (
      grounds !== null &&
      eligibilities.some((eligibility) => offerAdmits(eligibility, grounds))
    );
  }
  /** Отказ при запуске, если каталог продаёт, а у процесса нет настроек оплаты для этой продажи. */
  assertSaleConfigured(configuration: SalePaymentConfiguration): Promise<void> {
    return assertSaleConfigured(this.dependencies.prisma, configuration);
  }
  async quote(accountId: string, input: unknown) {
    const grounds = await readPurchaseGrounds(
      this.dependencies.grants,
      accountId,
    );
    if (grounds === null) return failure("dependency_unavailable");
    return quotePurchase(
      this.dependencies.prisma,
      accountId,
      input,
      this.clock,
      grounds,
    );
  }
  reserve(input: ReservePurchase) {
    return reservePurchase(this.dependencies.prisma, input, this.clock);
  }
  settle(input: SettleReservation) {
    return settleReservation(this.dependencies.prisma, input);
  }
}
