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
} from "../../modules/content-library/index.js";
import { AccountsModule } from "../../modules/accounts/index.js";
import { MemberProfilesModule } from "../../modules/member-profiles/index.js";
import { TelegramMembershipModule } from "../../modules/telegram-membership/index.js";
import {
  CreateDraftController,
  DeleteDraftController,
  LoadMaterialController,
  LoadSeriesOrderController,
  ListAuthoringReferencesController,
  ListMaterialsController,
  MaterialsModule,
  PreviewMaterialController,
  ReorderSeriesController,
  ReadPublishedMaterialController,
  SaveMaterialController,
  TransitionMaterialPublicationController,
  ValidateMaterialController,
  UploadMaterialAssetController,
  DeliverMaterialAssetController,
  CreateContentCollectionController,
  ListContentCollectionsController,
  SetContentCollectionArchiveController,
  UpdateContentCollectionController,
  KinescopeVideoAuthorizationController,
  VideoPlaybackController,
  VideoProgressController,
} from "../../modules/materials/index.js";
import {
  KinescopeWebhookController,
  VideoAuthoringController,
  VideosModule,
} from "../../modules/videos/index.js";
import { HealthController } from "./health.controller.js";

@Module({
  controllers: [
    HealthController,
    ListPublishedMaterialsController,
    DiscoverPublishedMaterialsController,
    ReadPublishedMaterialController,
    CreateDraftController,
    ListMaterialsController,
    ListAuthoringReferencesController,
    LoadMaterialController,
    LoadSeriesOrderController,
    SaveMaterialController,
    TransitionMaterialPublicationController,
    DeleteDraftController,
    ValidateMaterialController,
    PreviewMaterialController,
    ReorderSeriesController,
    UploadMaterialAssetController,
    DeliverMaterialAssetController,
    ListContentCollectionsController,
    CreateContentCollectionController,
    UpdateContentCollectionController,
    SetContentCollectionArchiveController,
    VideoAuthoringController,
    VideoPlaybackController,
    VideoProgressController,
    KinescopeWebhookController,
    KinescopeVideoAuthorizationController,
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
        RuntimeIdentityModule,
        PrismaModule,
        AccountsModule,
        MemberProfilesModule,
        TelegramMembershipModule,
        MaterialsModule,
        VideosModule,
      ],
    };
  }
}
