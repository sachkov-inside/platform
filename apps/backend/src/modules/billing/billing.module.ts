import { PLATFORM_CONFIG, type PlatformConfig } from "../../config/platform-config.js";
import { BillingContact } from "../accounts/index.js";
import { assembleAccessGrants } from "../membership-entitlements/index.js";
import { BillingPayments } from "./facets/billing-payments/billing-payments.js";
import { Tbank } from "./infrastructure/tbank/tbank.js";
import { PurchaseSubscriptionController } from "./features/purchase-subscription/purchase-subscription.controller.js";
import { AcceptTbankNotificationController } from "./features/accept-notification/accept-notification.controller.js";
import { Module } from "@nestjs/common";
import { PrismaClientProvider, PrismaModule } from "../../infrastructure/prisma/index.js";
import { ACCOUNTS, AccountsModule, type Accounts } from "../accounts/index.js";
import { BillingPricing } from "./facets/billing-pricing/billing-pricing.js";
import { ManageCatalogController } from "./features/manage-catalog/manage-catalog.controller.js";
import { QuotePurchaseController } from "./features/quote-purchase/quote-purchase.controller.js";
import { ListOffersController } from "./features/list-offers/list-offers.controller.js";

@Module({
  imports: [PrismaModule, AccountsModule],
  controllers: [PurchaseSubscriptionController, AcceptTbankNotificationController, ManageCatalogController, QuotePurchaseController, ListOffersController],
  providers: [{ provide: BillingPayments, inject: [PrismaClientProvider, ACCOUNTS, BillingContact, PLATFORM_CONFIG],
    useFactory: (prisma: PrismaClientProvider, accounts: Accounts, contact: BillingContact, config: PlatformConfig) => new BillingPayments({
      prisma, contact, grants: assembleAccessGrants({ prisma, accounts }), bank: config.tbank ? new Tbank(config.tbank) : undefined,
      confirmedInstant: undefined,
    }) }, { provide: BillingPricing, inject: [PrismaClientProvider, ACCOUNTS], useFactory: (prisma: PrismaClientProvider, accounts: Accounts) => new BillingPricing({ prisma, accounts }) }],
  exports: [BillingPayments],
})
export class BillingModule {}
