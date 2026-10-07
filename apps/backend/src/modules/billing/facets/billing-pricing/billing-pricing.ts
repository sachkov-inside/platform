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
import { listProductCohorts } from "../../features/list-product-cohorts/list-product-cohorts.js";
import {
  reservePurchase,
  type ReservePurchase,
} from "../../features/reserve-purchase/reserve-purchase.js";
import {
  settleReservation,
  type SettleReservation,
} from "../../features/settle-reservation/settle-reservation.js";
import {
  readPurchaseGrounds,
  type PurchaseGroundsReader,
} from "../../shared/offer-eligibility.js";
import type { AccessGrants } from "../../../account-rights/index.js";
import { failure } from "../../domain/pricing.js";

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
      grants?: PurchaseGroundsReader &
        Pick<AccessGrants, "readLegacyClassification">;
    },
  ) {
    this.clock = dependencies.clock ?? (() => new Date());
  }
  manage(actor: string, input: unknown) {
    return manageCatalog(this.dependencies, actor, input);
  }
  /** Витрина показывает доступные покупателю варианты; сбой чтения оснований не выдаётся за гостя. */
  async offers(input: unknown, accountId?: string) {
    const grounds = await readPurchaseGrounds(
      this.dependencies.grants,
      accountId,
    );
    if (grounds === null) return failure("dependency_unavailable");
    const legacy =
      accountId === undefined || this.dependencies.grants === undefined
        ? undefined
        : await this.dependencies.grants.readLegacyClassification(accountId);
    if (legacy !== undefined && !legacy.ok)
      return failure("dependency_unavailable");
    return listOffers(this.dependencies.prisma, input, this.clock, {
      publishedOnly: true,
      grounds,
      sale: this.dependencies.sale,
      recurringAllowed: legacy?.recurringAllowed ?? true,
    });
  }
  /** Текущие потоки продуктов: публичный факт, одинаковый для гостя, покупателя и владельца. */
  cohorts() {
    return listProductCohorts(this.dependencies.prisma);
  }
  /** Владельческий каталог: весь неархивный каталог вместе с выключенными из продажи предложениями. */
  ownerCatalog(input: unknown) {
    return listOffers(this.dependencies.prisma, input, this.clock, {
      publishedOnly: false,
    });
  }
  /** Подписка предлагается только допущенному по приглашению Account, независимо от состава прав тарифа. */
  async hasOffersForSale(accountId?: string): Promise<boolean> {
    let cursor: string | undefined;
    do {
      const result = await this.offers(
        {
          mode: "subscription",
          limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        },
        accountId,
      );
      if (!result.ok) return false;
      if (result.value.items.length > 0) return true;
      cursor = result.value.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return false;
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
    const legacy =
      this.dependencies.grants === undefined
        ? undefined
        : await this.dependencies.grants.readLegacyClassification(accountId);
    if (legacy !== undefined && !legacy.ok)
      return failure("dependency_unavailable");
    return quotePurchase(
      this.dependencies.prisma,
      accountId,
      input,
      this.clock,
      grounds,
      this.dependencies.sale,
      legacy?.recurringAllowed ?? true,
    );
  }
  reserve(input: ReservePurchase) {
    return reservePurchase(this.dependencies.prisma, input, this.clock);
  }
  settle(input: SettleReservation) {
    return settleReservation(this.dependencies.prisma, input);
  }
}
