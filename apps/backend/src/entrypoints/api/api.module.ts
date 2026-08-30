import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";

import { PlatformConfigModule } from "../../config/platform-config.module.js";
import type { PlatformConfig } from "../../config/platform-config.js";
import { HttpCachePolicyInterceptor } from "../../infrastructure/http/http-cache-policy.js";
import { ProblemDetailsFilter } from "../../infrastructure/http/problem-details.filter.js";
import { OperationalReadiness } from "../../infrastructure/operational-readiness.js";
import { PrismaModule } from "../../infrastructure/prisma/index.js";
import { ListPublishedMaterialsController } from "../../modules/content-library/index.js";
import { AccountsModule } from "../../modules/accounts/index.js";
import {
  CreateDraftController,
  DeleteDraftController,
  LoadMaterialController,
  ListAuthoringReferencesController,
  MaterialsModule,
  PreviewMaterialController,
  ReadPublishedMaterialController,
  SaveMaterialController,
  ValidateMaterialController,
} from "../../modules/materials/index.js";
import { HealthController } from "./health.controller.js";

@Module({
  controllers: [
    HealthController,
    ListPublishedMaterialsController,
    ReadPublishedMaterialController,
    CreateDraftController,
    ListAuthoringReferencesController,
    LoadMaterialController,
    SaveMaterialController,
    DeleteDraftController,
    ValidateMaterialController,
    PreviewMaterialController,
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
        MaterialsModule,
      ],
    };
  }
}
