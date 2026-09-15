import { ReceiveTributeController } from "./features/receive-tribute/receive-tribute.controller.js";
import { TributeConvergence } from "./facets/tribute-convergence/tribute-convergence.js";
import { PLATFORM_CONFIG, type PlatformConfig } from "../../config/platform-config.js";
import { BillingContact } from "../accounts/index.js";
import { ACCESS_GRANTS, TributeSources, MembershipEntitlementsModule, type AccessGrants } from "../membership-entitlements/index.js";
import { BillingPayments } from "./facets/billing-payments/billing-payments.js";
import { Tbank } from "./infrastructure/tbank/tbank.js";
import { bankRequest } from "./infrastructure/tbank/bank-request.js";
import { PurchaseSubscriptionController } from "./features/purchase-subscription/purchase-subscription.controller.js";
import { BillingSubscriptions } from "./facets/billing-subscriptions/billing-subscriptions.js";
import { ManageSubscriptionController } from "./features/manage-subscription/manage-subscription.controller.js";
import { ChangePaymentMethodController } from "./features/change-payment-method/change-payment-method.controller.js";
import { AcceptTbankNotificationController } from "./features/accept-notification/accept-notification.controller.js";
import { Module } from "@nestjs/common";
import { PrismaClientProvider, PrismaModule } from "../../infrastructure/prisma/index.js";
import { ACCOUNTS, AccountsModule, type Accounts } from "../accounts/index.js";
import { BillingNotices } from "./facets/billing-notices/billing-notices.js";
import { BillingPricing } from "./facets/billing-pricing/billing-pricing.js";
import { saleCapability } from "./domain/sale-capability.js";
import { ManageBillingController } from "./adapters/nest/manage-billing.controller.js";
import { BillingOperations } from "./facets/billing-operations/billing-operations.js";
import { QuotePurchaseController } from "./features/quote-purchase/quote-purchase.controller.js";
import { ListOffersController } from "./features/list-offers/list-offers.controller.js";

// Один банковский adapter на модуль: у привязки один владелец. Права выдаёт общий провайдер
// модуля прав, поэтому у оплаты нет собственной копии facet.
const BILLING_BANK = Symbol("BillingBank");

@Module({
  imports: [PrismaModule, AccountsModule, MembershipEntitlementsModule],
  controllers: [ReceiveTributeController, PurchaseSubscriptionController, ManageSubscriptionController, ChangePaymentMethodController, AcceptTbankNotificationController, ManageBillingController, QuotePurchaseController, ListOffersController],
  providers: [
    { provide: TributeConvergence, inject: [PrismaClientProvider, TributeSources], useFactory: (prisma: PrismaClientProvider, sources: TributeSources) => new TributeConvergence(prisma, sources) },
    { provide: BILLING_BANK, inject: [PLATFORM_CONFIG],
      useFactory: (config: PlatformConfig) => config.tbank ? new Tbank(config.tbank, bankRequest(config.tbank.caFile)) : undefined },
    { provide: BillingPayments, inject: [PrismaClientProvider, BillingContact, ACCESS_GRANTS, BILLING_BANK],
      useFactory: (prisma: PrismaClientProvider, contact: BillingContact, grants: AccessGrants, bank: Tbank | undefined) =>
        new BillingPayments({ prisma, contact, grants, bank }) },
    { provide: BillingNotices, inject: [PrismaClientProvider], useFactory: (prisma: PrismaClientProvider) => new BillingNotices({ prisma }) },
    { provide: BillingSubscriptions, inject: [PrismaClientProvider, BillingContact, ACCESS_GRANTS, BILLING_BANK, BillingPayments, BillingNotices],
      useFactory: (prisma: PrismaClientProvider, contact: BillingContact, grants: AccessGrants, bank: Tbank | undefined, payments: BillingPayments, notices: BillingNotices) =>
        new BillingSubscriptions({ prisma, contact, grants, bank, payments, notices }) },
    { provide: BillingPricing, inject: [PrismaClientProvider, ACCOUNTS, PLATFORM_CONFIG],
      useFactory: (prisma: PrismaClientProvider, accounts: Accounts, config: PlatformConfig) => new BillingPricing({ prisma, accounts, sale: saleCapability(config.tbank, config.billingContact !== undefined) }) },
    { provide: BillingOperations, inject: [PrismaClientProvider, ACCOUNTS, BillingPricing, BillingPayments, BillingSubscriptions, ACCESS_GRANTS, BILLING_BANK, TributeConvergence],
      useFactory: (prisma: PrismaClientProvider, accounts: Accounts, pricing: BillingPricing, payments: BillingPayments,
        subscriptions: BillingSubscriptions, grants: AccessGrants, bank: Tbank | undefined, tribute: TributeConvergence) =>
        new BillingOperations({ prisma, accounts, pricing, payments, subscriptions, grants, bank, tribute }) }],
  exports: [TributeConvergence, BillingPayments, BillingSubscriptions, BillingOperations, BillingNotices, BillingPricing],
})
export class BillingModule {}
