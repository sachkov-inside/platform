import { type DynamicModule, Module } from "@nestjs/common";

import { PlatformConfigModule } from "../config/platform-config.module.js";
import type { PlatformConfig } from "../config/platform-config.js";
import { OperationalReadiness } from "../infrastructure/operational-readiness.js";
import { PostgresModule } from "../infrastructure/postgres/index.js";

@Module({ providers: [OperationalReadiness] })
export class RuntimeModule {
  static forRoot(config: PlatformConfig): DynamicModule {
    return {
      module: RuntimeModule,
      imports: [PlatformConfigModule.forRoot(config), PostgresModule],
    };
  }
}
