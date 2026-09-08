import { Module } from "@nestjs/common";
import { PrismaClientProvider, PrismaModule } from "../../infrastructure/prisma/index.js";
import { ACCOUNTS, AccountsModule, type Accounts } from "../accounts/index.js";
import { BillingPricing } from "./facets/billing-pricing/billing-pricing.js";
import { ManageCatalogController } from "./features/manage-catalog/manage-catalog.controller.js";
import { QuotePurchaseController } from "./features/quote-purchase/quote-purchase.controller.js";
import { ListOffersController } from "./features/list-offers/list-offers.controller.js";

@Module({
  imports: [PrismaModule, AccountsModule],
  controllers: [ManageCatalogController, QuotePurchaseController, ListOffersController],
  providers: [{ provide: BillingPricing, inject: [PrismaClientProvider, ACCOUNTS], useFactory: (prisma: PrismaClientProvider, accounts: Accounts) => new BillingPricing({ prisma, accounts }) }],
})
export class BillingModule {}
