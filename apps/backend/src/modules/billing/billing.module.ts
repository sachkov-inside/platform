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
import { ListProductCohortsController } from "./features/list-product-cohorts/list-product-cohorts.controller.js";
import { BillingProductSales } from "./features/list-product-sales/list-product-sales.js";
import { PaymentLinksController } from "./features/payment-links/payment-links.controller.js";
import { PurchaseSubscriptionController } from "./features/purchase-subscription/purchase-subscription.controller.js";
import { QuotePurchaseController } from "./features/quote-purchase/quote-purchase.controller.js";
import { BillingSurveyRespondentSales } from "./features/read-survey-respondent-sales/read-survey-respondent-sales.js";
import { bankRequest } from "./infrastructure/tbank/bank-request.js";
import { Tbank } from "./infrastructure/tbank/tbank.js";

// Один банковский adapter на модуль: у привязки один владелец. Права выдаёт общий провайдер
// модуля прав, поэтому у оплаты нет собственной копии facet.
const BILLING_BANK = Symbol("BillingBank");

@Module({
  imports: [PrismaModule, AccountsModule, AccountRightsModule],
  controllers: [
    PurchaseSubscriptionController,
    AcceptTbankNotificationController,
    ManageBillingController,
    QuotePurchaseController,
    ListOffersController,
    ListProductCohortsController,
    PaymentLinksController,
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
        ACCESS_GRANTS,
        COVERAGE_CATALOG,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        config: PlatformConfig,
        grants: AccessGrants,
        contentCatalog: CoverageCatalog,
      ) =>
        new BillingPricing({
          contentCatalog,
          prisma,
          accounts,
          grants,
          sale: saleCapability(
            config.tbank,
            config.billingContact !== undefined,
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
  ],
})
export class BillingModule {}
