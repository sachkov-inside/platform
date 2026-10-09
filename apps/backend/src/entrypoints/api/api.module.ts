import { WebTelemetryHttpModule } from "../../modules/web-telemetry/index.js";
import { NotificationsModule } from "../../modules/notifications/index.js";
import { BillingModule } from "../../modules/billing/index.js";
import { ReadingActivityModule } from "../../modules/reading-activity/index.js";
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
  ListLearningPracticesController,
  ReadProductAccessController,
  ReadHomeContentController,
} from "../../modules/content-library/index.js";
import { AccountsModule } from "../../modules/accounts/index.js";
import { MemberProfilesModule } from "../../modules/member-profiles/index.js";
import {
  CommunityEntitlementsModule,
  RecipientLinksModule,
  TelegramMembershipModule,
} from "../../modules/telegram-membership/index.js";
import { AccountRightsModule } from "../../modules/account-rights/index.js";
import {
  CoverageCatalogModule,
  MaterialsHttpModule,
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
    ListLearningPracticesController,
    DiscoverPublishedMaterialsController,
    ReadHomeContentController,
    ReadProductAccessController,
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
        BookmarksModule,
        SalesFunnelModule,
        CommunicationsModule,
        CommunicationsTrackingDeliveryModule,
        MemberProfilesModule,
        TelegramMembershipModule,
        CommunityEntitlementsModule,
        AccountRightsModule,
        MaterialsModule,
        MaterialsHttpModule,
        ProductTasksHttpModule,
        VideosModule,
        CoverageCatalogModule,
        RecipientLinksModule,
        ProductTaskResourceFactsModule,
      ],
    };
  }
}
