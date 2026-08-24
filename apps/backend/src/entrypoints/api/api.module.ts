import { type DynamicModule, Module } from "@nestjs/common";

import { PlatformConfigModule } from "../../config/platform-config.module.js";
import type { PlatformConfig } from "../../config/platform-config.js";
import { ReadinessModule } from "../../modules/readiness/readiness.module.js";
import { HealthController } from "./health.controller.js";

@Module({
  controllers: [HealthController],
})
export class ApiModule {
  static forRoot(config: PlatformConfig): DynamicModule {
    return {
      module: ApiModule,
      imports: [PlatformConfigModule.forRoot(config), ReadinessModule],
    };
  }
}
