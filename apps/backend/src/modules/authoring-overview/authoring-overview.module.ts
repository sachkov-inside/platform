import { Module } from "@nestjs/common";

import {
  ACCESS_GRANTS,
  AccountRightsModule,
  type AccessGrants,
} from "../account-rights/index.js";
import {
  ACCOUNTS,
  AccountDirectory,
  AccountsModule,
  type Accounts,
} from "../accounts/index.js";
import { BillingModule, BillingSalesOverview } from "../billing/index.js";
import { Notifications, NotificationsModule } from "../notifications/index.js";
import {
  PeopleDirectory,
  PeopleDirectoryHttpModule,
} from "../people-directory/index.js";
import {
  ProductTasksModule,
  SUBMISSION_REVIEW,
  type SubmissionReview,
} from "../product-tasks/index.js";
import {
  ProductDiscovery,
  ProductOutlines,
  ProductReadingModule,
  ProductsModule,
} from "../products/index.js";
import {
  ReadingActivity,
  ReadingActivityModule,
} from "../reading-activity/index.js";
import {
  ProductWaitlists,
  SalesFunnel,
  SalesFunnelModule,
} from "../sales-funnel/index.js";
import {
  CommunityEntitlements,
  CommunityEntitlementsModule,
  TelegramAccountLinks,
  TelegramAccountLinksModule,
} from "../telegram-membership/index.js";
import { ReadAuthoringOverviewController } from "./features/read-authoring-overview/read-authoring-overview.controller.js";
import { ReadProductOverviewController } from "./features/read-product-overview/read-product-overview.controller.js";
import { AuthoringOverviewReads } from "./shared/overview-reads.js";

/**
 * The admin Overview (#1719): reads composed over the owners of sales, access, people, waitlists,
 * submissions, Telegram and learning. It owns no table and no right of its own, and no Module
 * imports it (ADR 0029); the API process imports the Module.
 */
@Module({
  imports: [
    AccountsModule,
    AccountRightsModule,
    BillingModule,
    CommunityEntitlementsModule,
    NotificationsModule,
    PeopleDirectoryHttpModule,
    ProductReadingModule,
    ProductsModule,
    ProductTasksModule,
    ReadingActivityModule,
    SalesFunnelModule,
    TelegramAccountLinksModule,
  ],
  controllers: [ReadAuthoringOverviewController, ReadProductOverviewController],
  providers: [
    {
      provide: AuthoringOverviewReads,
      inject: [
        ACCOUNTS,
        AccountDirectory,
        TelegramAccountLinks,
        BillingSalesOverview,
        ACCESS_GRANTS,
        ProductDiscovery,
        ProductOutlines,
        SalesFunnel,
        ProductWaitlists,
        ReadingActivity,
        SUBMISSION_REVIEW,
        CommunityEntitlements,
        Notifications,
        PeopleDirectory,
      ],
      useFactory: (
        accounts: Accounts,
        directory: AccountDirectory,
        links: TelegramAccountLinks,
        sales: BillingSalesOverview,
        access: AccessGrants,
        products: ProductDiscovery,
        outlines: ProductOutlines,
        funnel: SalesFunnel,
        waitlists: ProductWaitlists,
        learning: ReadingActivity,
        submissions: SubmissionReview,
        community: CommunityEntitlements,
        deliveries: Notifications,
        people: PeopleDirectory,
      ) =>
        new AuthoringOverviewReads({
          accounts,
          directory,
          links,
          sales,
          access,
          products,
          outlines,
          funnel,
          waitlists,
          learning,
          submissions,
          community,
          deliveries,
          people,
          clock: () => new Date(),
        }),
    },
  ],
})
export class AuthoringOverviewModule {}
