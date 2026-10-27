import { Module } from "@nestjs/common";

import {
  ACCESS_GRANTS,
  AccountRightsModule,
  type AccessGrants,
} from "../account-rights/index.js";
import {
  AccountDirectory,
  ACCOUNTS,
  AccountsModule,
  type Accounts,
} from "../accounts/index.js";
import { BillingModule, BillingOperations } from "../billing/index.js";
import {
  ProductTasksModule,
  SUBMISSION_REVIEW,
  type SubmissionReview,
} from "../product-tasks/index.js";
import { ProductDiscovery, ProductsModule } from "../products/index.js";
import {
  ReadingActivity,
  ReadingActivityModule,
} from "../reading-activity/index.js";
import { ProductWaitlists, SalesFunnelModule } from "../sales-funnel/index.js";
import { Notifications, NotificationsModule } from "../notifications/index.js";
import {
  CommunityEntitlements,
  CommunityEntitlementsModule,
  TelegramAccountLinks,
  TelegramAccountLinksModule,
} from "../telegram-membership/index.js";
import { PeopleDirectory } from "./facets/people-directory/people-directory.js";
import { ListPeopleController } from "./features/list-people/list-people.controller.js";
import { ListProductChoicesController } from "./features/list-product-choices/list-product-choices.controller.js";
import { ReadPeopleIdentitiesController } from "./features/read-people-identities/read-people-identities.controller.js";
import { ReadPersonController } from "./features/read-person/read-person.controller.js";
import { SearchPeopleController } from "./features/search-people/search-people.controller.js";

/**
 * The owner's people directory (#1721): reads composed over the owners of each fact. Nothing it
 * answers is a source of rights. The API process imports it, and the authoring search takes its
 * people group and the payments of the people it finds from the exported facet.
 */
@Module({
  imports: [
    AccountsModule,
    AccountRightsModule,
    BillingModule,
    CommunityEntitlementsModule,
    NotificationsModule,
    ProductsModule,
    ProductTasksModule,
    ReadingActivityModule,
    SalesFunnelModule,
    TelegramAccountLinksModule,
  ],
  // Static paths (`search`, `identities`, `product-choices`) precede the parametric card path in
  // the router.
  controllers: [
    ListPeopleController,
    ListProductChoicesController,
    SearchPeopleController,
    ReadPeopleIdentitiesController,
    ReadPersonController,
  ],
  providers: [
    {
      provide: PeopleDirectory,
      inject: [
        ACCOUNTS,
        AccountDirectory,
        TelegramAccountLinks,
        ACCESS_GRANTS,
        ProductDiscovery,
        ReadingActivity,
        BillingOperations,
        SUBMISSION_REVIEW,
        CommunityEntitlements,
        ProductWaitlists,
        Notifications,
      ],
      useFactory: (
        accounts: Accounts,
        directory: AccountDirectory,
        telegram: TelegramAccountLinks,
        access: AccessGrants,
        products: ProductDiscovery,
        learning: ReadingActivity,
        payments: BillingOperations,
        submissions: SubmissionReview,
        community: CommunityEntitlements,
        waitlists: ProductWaitlists,
        deliveries: Notifications,
      ) =>
        new PeopleDirectory({
          accounts,
          directory,
          telegram,
          access,
          products,
          learning,
          payments,
          submissions,
          community,
          waitlists,
          deliveries,
        }),
    },
  ],
  exports: [PeopleDirectory],
})
export class PeopleDirectoryHttpModule {}
