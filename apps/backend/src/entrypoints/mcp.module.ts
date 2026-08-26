import { type DynamicModule, Module } from "@nestjs/common";

import { PlatformConfigModule } from "../config/platform-config.module.js";
import type { PlatformConfig } from "../config/platform-config.js";
import { OperationalReadiness } from "../infrastructure/operational-readiness.js";
import { PostgresModule } from "../infrastructure/postgres/index.js";
import { MaterialsModule } from "../modules/materials/index.js";

@Module({ providers: [OperationalReadiness] })
export class McpModule {
  static forRoot(config: PlatformConfig): DynamicModule {
    return {
      module: McpModule,
      imports: [PlatformConfigModule.forRoot(config), PostgresModule, MaterialsModule],
    };
  }
}
