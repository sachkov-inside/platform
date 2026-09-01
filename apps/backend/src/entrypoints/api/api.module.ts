import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";

import { PlatformConfigModule } from "../../config/platform-config.module.js";
import type { PlatformConfig } from "../../config/platform-config.js";
import { HttpCachePolicyInterceptor } from "../../infrastructure/http/http-cache-policy.js";
import { ProblemDetailsFilter } from "../../infrastructure/http/problem-details.filter.js";
import { OperationalReadiness } from "../../infrastructure/operational-readiness.js";
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
  ValidateMaterialController,
  UploadMaterialAssetController,
  DeliverMaterialAssetController,
} from "../../modules/materials/index.js";
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
    DeleteDraftController,
    ValidateMaterialController,
    PreviewMaterialController,
    ReorderSeriesController,
    UploadMaterialAssetController,
    DeliverMaterialAssetController,
  ],
  providers: [
    OperationalReadiness,
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_INTERCEPTOR, useClass: HttpCachePolicyInterceptor },
  ],
})
export class ApiModule {
  static forRoot(config: PlatformConfig): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        PlatformConfigModule.forRoot(config),
        PrismaModule,
        AccountsModule,
        MemberProfilesModule,
        TelegramMembershipModule,
        MaterialsModule,
      ],
    };
  }
}
