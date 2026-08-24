import { type DynamicModule, Module } from "@nestjs/common";

import { PlatformConfigModule } from "../config/platform-config.module.js";
import type { PlatformConfig } from "../config/platform-config.js";
import { ReadinessModule } from "../modules/readiness/readiness.module.js";

@Module({})
export class RuntimeModule {
  static forRoot(config: PlatformConfig): DynamicModule {
    return {
      module: RuntimeModule,
      imports: [PlatformConfigModule.forRoot(config), ReadinessModule],
    };
  }
}
