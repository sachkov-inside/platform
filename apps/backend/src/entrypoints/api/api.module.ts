import { type DynamicModule, Module } from "@nestjs/common";

import { PlatformConfigModule } from "../../config/platform-config.module.js";
import type { PlatformConfig } from "../../config/platform-config.js";
import { OperationalReadiness } from "../../infrastructure/operational-readiness.js";
import { PrismaModule } from "../../infrastructure/prisma/index.js";
import { ListPublishedMaterialsController } from "../../modules/content-library/index.js";
import { AccountsModule } from "../../modules/accounts/index.js";
import {
  MaterialsModule,
  ReadPublishedMaterialController,
} from "../../modules/materials/index.js";
import { HealthController } from "./health.controller.js";

@Module({
  controllers: [
    HealthController,
    ListPublishedMaterialsController,
    ReadPublishedMaterialController,
  ],
  providers: [OperationalReadiness],
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
