import { ListProductSalesStatesController } from "./features/list-product-sales-states/list-product-sales-states.controller.js";
import { ReadOwnBillingController } from "./features/read-own-billing/read-own-billing.controller.js";
import { Module } from "@nestjs/common";
import {
  configuredTelegramBotStartUrl,
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  ACCESS_GRANTS,
  AccountRightsModule,
  COVERAGE_CATALOG,
  type AccessGrants,
  type CoverageCatalog,
} from "../account-rights/index.js";
import {
  ACCOUNTS,
  AccountsModule,
  BillingContact,
  type Accounts,
} from "../accounts/index.js";
import { ManageBillingController } from "./adapters/nest/manage-billing.controller.js";
import { saleCapability } from "./domain/sale-capability.js";
import { BillingNotices } from "./facets/billing-notices/billing-notices.js";
import { BillingOperations } from "./facets/billing-operations/billing-operations.js";
import { BillingPayments } from "./facets/billing-payments/billing-payments.js";
import { BillingPricing } from "./facets/billing-pricing/billing-pricing.js";
import { AcceptTbankNotificationController } from "./features/accept-notification/accept-notification.controller.js";
import { ListOffersController } from "./features/list-offers/list-offers.controller.js";
import { BillingProductSales } from "./features/list-product-sales/list-product-sales.js";
import { PaymentLinksController } from "./features/payment-links/payment-links.controller.js";
import { PurchaseProductController } from "./features/purchase-product/purchase-product.controller.js";
import { QuotePurchaseController } from "./features/quote-purchase/quote-purchase.controller.js";
import { OwnerOrderEmailRead } from "./features/read-order-email/read-order-email.js";
import { ReadOwnerOrderEmailController } from "./features/read-order-email/read-order-email.controller.js";
import { BillingPaymentSearch } from "./features/search-payments/search-payments.js";
import { BillingSurveyRespondentSales } from "./features/read-survey-respondent-sales/read-survey-respondent-sales.js";
import { bankRequest } from "./infrastructure/tbank/bank-request.js";
import { Tbank } from "./infrastructure/tbank/tbank.js";

// Один банковский adapter на модуль: у привязки один владелец. Права выдаёт общий провайдер
// модуля прав, поэтому у оплаты нет собственной копии facet.
const BILLING_BANK = Symbol("BillingBank");

@Module({
  imports: [PrismaModule, AccountsModule, AccountRightsModule],
  controllers: [
    ReadOwnBillingController,
    PurchaseProductController,
    AcceptTbankNotificationController,
    ManageBillingController,
    QuotePurchaseController,
    ListOffersController,
    ListProductSalesStatesController,
    PaymentLinksController,
    ReadOwnerOrderEmailController,
  ],
  providers: [
    {
      provide: BillingProductSales,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        new BillingProductSales(prisma),
    },
    {
      provide: BillingSurveyRespondentSales,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        new BillingSurveyRespondentSales(prisma),
    },
    {
      provide: BILLING_BANK,
      inject: [PLATFORM_CONFIG],
      useFactory: (config: PlatformConfig) =>
        config.tbank
          ? new Tbank(config.tbank, bankRequest(config.tbank.caFile))
          : undefined,
    },
    {
      provide: BillingPayments,
      inject: [
        PrismaClientProvider,
        BillingContact,
        ACCESS_GRANTS,
        BILLING_BANK,
        COVERAGE_CATALOG,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        contact: BillingContact,
        grants: AccessGrants,
        bank: Tbank | undefined,
        contentCatalog: CoverageCatalog,
      ) =>
        new BillingPayments({ prisma, contact, grants, bank, contentCatalog }),
    },
    {
      provide: OwnerOrderEmailRead,
      inject: [PrismaClientProvider, ACCOUNTS, BILLING_BANK],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        bank: Tbank | undefined,
      ) => new OwnerOrderEmailRead({ prisma, accounts, bank }),
    },
    {
      provide: BillingPaymentSearch,
      inject: [PrismaClientProvider, ACCOUNTS],
      useFactory: (prisma: PrismaClientProvider, accounts: Accounts) =>
        new BillingPaymentSearch({ prisma, accounts }),
    },
    {
      provide: BillingNotices,
      inject: [PrismaClientProvider],
      useFactory: (prisma: PrismaClientProvider) =>
        new BillingNotices({ prisma }),
    },
    {
      provide: BillingPricing,
      inject: [
        PrismaClientProvider,
        ACCOUNTS,
        PLATFORM_CONFIG,
        COVERAGE_CATALOG,
        BillingContact,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        config: PlatformConfig,
        contentCatalog: CoverageCatalog,
        contact: BillingContact,
      ) =>
        new BillingPricing({
          contentCatalog,
          prisma,
          accounts,
          sale: saleCapability(
            config.tbank,
            config.billingContact !== undefined &&
              contact.hasApprovedProductTerms(),
          ),
        }),
    },
    {
      provide: BillingOperations,
      inject: [
        PrismaClientProvider,
        ACCOUNTS,
        BillingPricing,
        BillingPayments,
        ACCESS_GRANTS,
        BILLING_BANK,
        PLATFORM_CONFIG,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        pricing: BillingPricing,
        payments: BillingPayments,
        grants: AccessGrants,
        bank: Tbank | undefined,
        config: PlatformConfig,
      ) =>
        new BillingOperations({
          prisma,
          accounts,
          pricing,
          payments,
          grants,
          bank,
          botStartUrl: configuredTelegramBotStartUrl(config),
        }),
    },
  ],
  exports: [
    BillingProductSales,
    BillingSurveyRespondentSales,
    BillingPayments,
    BillingOperations,
    BillingNotices,
    BillingPricing,
    BillingPaymentSearch,
  ],
})
export class BillingModule {}
