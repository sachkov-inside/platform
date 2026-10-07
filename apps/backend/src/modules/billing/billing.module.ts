import { BillingProductSales } from "./features/list-product-sales/list-product-sales.js";
import { BillingSurveyRespondentSales } from "./features/read-survey-respondent-sales/read-survey-respondent-sales.js";
import { ReceiveTributeController } from "./features/receive-tribute/receive-tribute.controller.js";
import { TributeConvergence } from "./facets/tribute-convergence/tribute-convergence.js";
import {
  configuredTelegramBotStartUrl,
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import { BillingContact } from "../accounts/index.js";
import {
  ACCESS_GRANTS,
  TributeSources,
  AccountRightsModule,
  type AccessGrants,
} from "../account-rights/index.js";
import { BillingPayments } from "./facets/billing-payments/billing-payments.js";
import { Tbank } from "./infrastructure/tbank/tbank.js";
import { bankRequest } from "./infrastructure/tbank/bank-request.js";
import { PurchaseSubscriptionController } from "./features/purchase-subscription/purchase-subscription.controller.js";
import { BillingSubscriptions } from "./facets/billing-subscriptions/billing-subscriptions.js";
import { ManageSubscriptionController } from "./features/manage-subscription/manage-subscription.controller.js";
import { ChangePaymentMethodController } from "./features/change-payment-method/change-payment-method.controller.js";
import { AcceptTbankNotificationController } from "./features/accept-notification/accept-notification.controller.js";
import { Module } from "@nestjs/common";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { ACCOUNTS, AccountsModule, type Accounts } from "../accounts/index.js";
import { BillingNotices } from "./facets/billing-notices/billing-notices.js";
import { BillingPricing } from "./facets/billing-pricing/billing-pricing.js";
import { saleCapability } from "./domain/sale-capability.js";
import { ManageBillingController } from "./adapters/nest/manage-billing.controller.js";
import { BillingOperations } from "./facets/billing-operations/billing-operations.js";
import { QuotePurchaseController } from "./features/quote-purchase/quote-purchase.controller.js";
import { ListOffersController } from "./features/list-offers/list-offers.controller.js";
import { ListProductCohortsController } from "./features/list-product-cohorts/list-product-cohorts.controller.js";

// Один банковский adapter на модуль: у привязки один владелец. Права выдаёт общий провайдер
// модуля прав, поэтому у оплаты нет собственной копии facet.
const BILLING_BANK = Symbol("BillingBank");

@Module({
  imports: [PrismaModule, AccountsModule, AccountRightsModule],
  controllers: [
    ReceiveTributeController,
    PurchaseSubscriptionController,
    ManageSubscriptionController,
    ChangePaymentMethodController,
    AcceptTbankNotificationController,
    ManageBillingController,
    QuotePurchaseController,
    ListOffersController,
    ListProductCohortsController,
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
      provide: TributeConvergence,
      inject: [PrismaClientProvider, TributeSources],
      useFactory: (prisma: PrismaClientProvider, sources: TributeSources) =>
        new TributeConvergence(prisma, sources),
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
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        contact: BillingContact,
        grants: AccessGrants,
        bank: Tbank | undefined,
      ) => new BillingPayments({ prisma, contact, grants, bank }),
    },
    {
      provide: BillingNotices,
      inject: [PrismaClientProvider, ACCESS_GRANTS],
      useFactory: (prisma: PrismaClientProvider, grants: AccessGrants) =>
        new BillingNotices({ prisma, enrollments: grants }),
    },
    {
      provide: BillingSubscriptions,
      inject: [
        PrismaClientProvider,
        BillingContact,
        ACCESS_GRANTS,
        BILLING_BANK,
        BillingPayments,
        BillingNotices,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        contact: BillingContact,
        grants: AccessGrants,
        bank: Tbank | undefined,
        payments: BillingPayments,
        notices: BillingNotices,
      ) =>
        new BillingSubscriptions({
          prisma,
          contact,
          grants,
          bank,
          payments,
          notices,
        }),
    },
    {
      provide: BillingPricing,
      inject: [PrismaClientProvider, ACCOUNTS, PLATFORM_CONFIG, ACCESS_GRANTS],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        config: PlatformConfig,
        grants: AccessGrants,
      ) =>
        new BillingPricing({
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
        BillingSubscriptions,
        ACCESS_GRANTS,
        BILLING_BANK,
        TributeConvergence,
        PLATFORM_CONFIG,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        pricing: BillingPricing,
        payments: BillingPayments,
        subscriptions: BillingSubscriptions,
        grants: AccessGrants,
        bank: Tbank | undefined,
        tribute: TributeConvergence,
        config: PlatformConfig,
      ) =>
        new BillingOperations({
          prisma,
          accounts,
          pricing,
          payments,
          subscriptions,
          grants,
          bank,
          tribute,
          botStartUrl: configuredTelegramBotStartUrl(config),
        }),
    },
  ],
  exports: [
    BillingProductSales,
    BillingSurveyRespondentSales,
    TributeConvergence,
    BillingPayments,
    BillingSubscriptions,
    BillingOperations,
    BillingNotices,
    BillingPricing,
  ],
})
export class BillingModule {}
