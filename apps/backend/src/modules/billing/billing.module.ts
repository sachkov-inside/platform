import { PLATFORM_CONFIG, type PlatformConfig } from "../../config/platform-config.js";
import { BillingContact } from "../accounts/index.js";
import { assembleAccessGrants } from "../membership-entitlements/index.js";
import { BillingPayments } from "./facets/billing-payments/billing-payments.js";
import { Tbank } from "./infrastructure/tbank/tbank.js";
import { PurchaseSubscriptionController } from "./features/purchase-subscription/purchase-subscription.controller.js";
import { BillingSubscriptions } from "./facets/billing-subscriptions/billing-subscriptions.js";
import { ManageSubscriptionController } from "./features/manage-subscription/manage-subscription.controller.js";
import { ChangePaymentMethodController } from "./features/change-payment-method/change-payment-method.controller.js";
import { AcceptTbankNotificationController } from "./features/accept-notification/accept-notification.controller.js";
import { Module } from "@nestjs/common";
import { PrismaClientProvider, PrismaModule } from "../../infrastructure/prisma/index.js";
import { ACCOUNTS, AccountsModule, type Accounts } from "../accounts/index.js";
import { BillingPricing } from "./facets/billing-pricing/billing-pricing.js";
import { ManageCatalogController } from "./features/manage-catalog/manage-catalog.controller.js";
import { QuotePurchaseController } from "./features/quote-purchase/quote-purchase.controller.js";
import { ListOffersController } from "./features/list-offers/list-offers.controller.js";

// Один банковский adapter и один entitlement facet на модуль: у привязки и прав один владелец.
const BILLING_BANK = Symbol("BillingBank");
const BILLING_GRANTS = Symbol("BillingAccessGrants");
type BillingGrants = ReturnType<typeof assembleAccessGrants>;

@Module({
  imports: [PrismaModule, AccountsModule],
  controllers: [PurchaseSubscriptionController, ManageSubscriptionController, ChangePaymentMethodController, AcceptTbankNotificationController, ManageCatalogController, QuotePurchaseController, ListOffersController],
  providers: [
    { provide: BILLING_BANK, inject: [PLATFORM_CONFIG],
      useFactory: (config: PlatformConfig) => config.tbank ? new Tbank(config.tbank) : undefined },
    { provide: BILLING_GRANTS, inject: [PrismaClientProvider, ACCOUNTS],
      useFactory: (prisma: PrismaClientProvider, accounts: Accounts) => assembleAccessGrants({ prisma, accounts }) },
    { provide: BillingPayments, inject: [PrismaClientProvider, BillingContact, BILLING_GRANTS, BILLING_BANK],
      useFactory: (prisma: PrismaClientProvider, contact: BillingContact, grants: BillingGrants, bank: Tbank | undefined) =>
        new BillingPayments({ prisma, contact, grants, bank }) },
    { provide: BillingSubscriptions, inject: [PrismaClientProvider, BillingContact, BILLING_GRANTS, BILLING_BANK, BillingPayments],
      useFactory: (prisma: PrismaClientProvider, contact: BillingContact, grants: BillingGrants, bank: Tbank | undefined, payments: BillingPayments) =>
        new BillingSubscriptions({ prisma, contact, grants, bank, payments }) },
    { provide: BillingPricing, inject: [PrismaClientProvider, ACCOUNTS], useFactory: (prisma: PrismaClientProvider, accounts: Accounts) => new BillingPricing({ prisma, accounts }) }],
  exports: [BillingPayments, BillingSubscriptions],
})
export class BillingModule {}
