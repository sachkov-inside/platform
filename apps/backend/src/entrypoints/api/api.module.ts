import { ProductReadingModule } from "../../modules/products/index.js";
import { ProductAuthoringCompositionModule } from "../composition/product-authoring-composition.module.js";
import { ContentAccessCompositionModule } from "../composition/content-access-composition.module.js";
import { WebTelemetryHttpModule } from "../../modules/web-telemetry/index.js";
import { AuthoringSearchHttpModule } from "../../modules/authoring-search/index.js";
import { PeopleDirectoryHttpModule } from "../../modules/people-directory/index.js";
import { NotificationsModule } from "../../modules/notifications/index.js";
import { BillingModule } from "../../modules/billing/index.js";
import { ReadingActivityModule } from "../../modules/reading-activity/index.js";
import { ProductLearnersModule } from "../../modules/product-learners/index.js";
import { AuthoringOverviewModule } from "../../modules/authoring-overview/index.js";
import { BookmarksModule } from "../../modules/bookmarks/index.js";
import { SalesFunnelModule } from "../../modules/sales-funnel/index.js";
import {
  CommunicationsModule,
  CommunicationsTrackingDeliveryModule,
} from "../../modules/communications/index.js";
import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";

import { PlatformConfigModule } from "../../config/platform-config.module.js";
import type { PlatformConfig } from "../../config/platform-config.js";
import { HttpCachePolicyInterceptor } from "../../infrastructure/http/http-cache-policy.js";
import { ProblemDetailsFilter } from "../../infrastructure/http/problem-details.filter.js";
import { OperationalReadiness } from "../../infrastructure/operational-readiness.js";
import { RuntimeIdentityModule } from "../../infrastructure/runtime-identity.js";
import { PrismaModule } from "../../infrastructure/prisma/index.js";
import {
  DiscoverPublishedMaterialsController,
  ListPublishedMaterialsController,
  ListPublicSiteIndexController,
  ReadProductAccessController,
  ReadReaderReferenceController,
  ReadProductSaleAvailabilityController,
  ReadHomeContentController,
} from "../../modules/content-library/index.js";
import { AccountsModule } from "../../modules/accounts/index.js";
import { AccountProfilesModule } from "../../modules/account-profiles/index.js";
import {
  CommunityEntitlementsModule,
  RecipientLinksModule,
  TelegramMembershipModule,
} from "../../modules/telegram-membership/index.js";
import { AccountRightsModule } from "../../modules/account-rights/index.js";
import {
  CoverageCatalogModule,
  MaterialsHttpModule,
  MaterialContentModule,
  MaterialsModule,
} from "../../modules/materials/index.js";
import {
  KinescopeWebhookController,
  VideoAuthoringController,
  VideosModule,
} from "../../modules/videos/index.js";
import {
  ProductTaskResourceFactsModule,
  ProductTasksHttpModule,
} from "../../modules/product-tasks/index.js";
import { HealthController } from "./health.controller.js";

@Module({
  controllers: [
    HealthController,
    ListPublishedMaterialsController,
    ListPublicSiteIndexController,
    DiscoverPublishedMaterialsController,
    ReadHomeContentController,
    ReadProductAccessController,
    ReadReaderReferenceController,
    ReadProductSaleAvailabilityController,
    VideoAuthoringController,
    KinescopeWebhookController,
  ],
  providers: [
    OperationalReadiness,
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_INTERCEPTOR, useClass: HttpCachePolicyInterceptor },
  ],
})
export class ApiModule {
  static forRoot(config?: PlatformConfig): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        PlatformConfigModule.forRoot(config),
        NotificationsModule,
        RuntimeIdentityModule,
        PrismaModule,
        AccountsModule,
        WebTelemetryHttpModule,
        BillingModule,
        ReadingActivityModule,
        ProductLearnersModule,
        AuthoringOverviewModule,
        BookmarksModule,
        SalesFunnelModule,
        CommunicationsModule,
        CommunicationsTrackingDeliveryModule,
        AccountProfilesModule,
        TelegramMembershipModule,
        CommunityEntitlementsModule,
        AccountRightsModule,
        MaterialsModule,
        ContentAccessCompositionModule,
        ProductAuthoringCompositionModule,
        MaterialsHttpModule,
        MaterialContentModule,
        ProductReadingModule,
        ProductTasksHttpModule,
        AuthoringSearchHttpModule,
        PeopleDirectoryHttpModule,
        VideosModule,
        CoverageCatalogModule,
        RecipientLinksModule,
        ProductTaskResourceFactsModule,
      ],
    };
  }
}
