import {
  isProductCapability,
  productIdFromCapability,
} from "@inside/access-capabilities";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { CoverageCatalog } from "../../../account-rights/index.js";
import type { Accounts } from "../../../accounts/index.js";
import { failure } from "../../domain/pricing.js";
import type { SaleCapability } from "../../domain/sale-capability.js";
import {
  assertSaleConfigured,
  type SalePaymentConfiguration,
} from "../../features/assert-sale-configured/assert-sale-configured.js";
import { listOffers } from "../../features/list-offers/list-offers.js";
import { listProductSalesStates } from "../../features/list-product-sales-states/list-product-sales-states.js";
import { manageCatalog } from "../../features/manage-catalog/manage-catalog.js";
import {
  listPaymentLinks,
  managePaymentLink,
  readPaymentLink,
} from "../../features/payment-links/payment-links.js";
import { quotePurchase } from "../../features/quote-purchase/quote-purchase.js";
import { readProductSaleAvailability } from "../../features/read-product-sale-availability/read-product-sale-availability.js";
import {
  reservePurchase,
  type ReservePurchase,
} from "../../features/reserve-purchase/reserve-purchase.js";
import {
  settleReservation,
  type SettleReservation,
} from "../../features/settle-reservation/settle-reservation.js";

export class BillingPricing {
  private readonly clock: () => Date;
  /** `sale` — что процесс вправе продавать; каталог не включает продажу сверх этого. */
  constructor(
    private readonly dependencies: {
      prisma: BillingPrismaClient;
      accounts: Pick<Accounts, "checkPermission">;
      clock?: () => Date;
      sale: SaleCapability;
      contentCatalog?: CoverageCatalog;
    },
  ) {
    this.clock = dependencies.clock ?? (() => new Date());
  }
  manage(actor: string, input: unknown) {
    return manageCatalog(this.dependencies, actor, input);
  }
  offers(input: unknown, _accountId?: string) {
    return listOffers(this.dependencies.prisma, input, this.clock, {
      publishedOnly: true,
      contentCatalog: this.dependencies.contentCatalog,
      sale: this.dependencies.sale,
    });
  }
  saleAvailability(input: unknown, _accountId?: string) {
    return readProductSaleAvailability(
      this.dependencies.prisma,
      input,
      this.clock,
      {
        sale: this.dependencies.sale,
        contentCatalog: this.dependencies.contentCatalog,
      },
    );
  }
  productSalesStates(productId?: string, cursor?: string) {
    return listProductSalesStates(this.dependencies.prisma, productId, cursor);
  }
  /** Old strict wire reader compatibility until separately built readers migrate (#1712). */
  cohorts(productId?: string, cursor?: string) {
    return this.productSalesStates(productId, cursor);
  }
  ownerCatalog(input: unknown) {
    return listOffers(this.dependencies.prisma, input, this.clock, {
      publishedOnly: false,
    });
  }
  assertSaleConfigured(configuration: SalePaymentConfiguration): Promise<void> {
    return assertSaleConfigured(this.dependencies.prisma, configuration);
  }
  quote(accountId: string, input: unknown) {
    return quotePurchase(
      this.dependencies.prisma,
      accountId,
      input,
      this.clock,
      this.dependencies.sale,
      this.dependencies.contentCatalog,
    );
  }
  managePaymentLink(actor: string, input: unknown) {
    return managePaymentLink(this.dependencies, actor, input, this.clock());
  }
  paymentLinks(actor: string, input: unknown) {
    return listPaymentLinks(this.dependencies, actor, input, this.clock());
  }
  async paymentLink(id: string) {
    const result = await readPaymentLink(
      this.dependencies.prisma,
      id,
      this.clock(),
    );
    if (!result.ok) return result;
    try {
      const capability =
        result.value.snapshot.offer.benefits.find(isProductCapability);
      const productId =
        capability === undefined ? null : productIdFromCapability(capability);
      const entries =
        productId === null
          ? []
          : ((await this.dependencies.contentCatalog?.resolve({
              productIds: [productId],
              materialIds: [],
            })) ?? []);
      const product =
        entries.find(
          (entry) => entry.kind === "product" && entry.id === productId,
        ) ?? null;
      return {
        ok: true as const,
        value: {
          id: result.value.id,
          revision: result.value.revision,
          state: result.value.state,
          snapshot: result.value.snapshot,
          createdAt: result.value.createdAt,
          expiresAt: result.value.expiresAt,
          product,
        },
      };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "paymentLink" },
        error,
        failure("dependency_unavailable"),
      );
    }
  }
  reserve(input: ReservePurchase) {
    return reservePurchase(
      this.dependencies.prisma,
      input,
      this.clock,
      this.dependencies.contentCatalog,
    );
  }
  settle(input: SettleReservation) {
    return settleReservation(this.dependencies.prisma, input);
  }
}
