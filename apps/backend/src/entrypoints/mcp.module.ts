import { type DynamicModule, Module } from "@nestjs/common";

import { PlatformConfigModule } from "../config/platform-config.module.js";
import type { PlatformConfig } from "../config/platform-config.js";
import { OperationalReadiness } from "../infrastructure/operational-readiness.js";
import { PrismaModule } from "../infrastructure/prisma/index.js";

@Module({ providers: [OperationalReadiness] })
export class McpModule {
  static forRoot(config: PlatformConfig): DynamicModule {
    return {
      module: McpModule,
      imports: [PlatformConfigModule.forRoot(config), PrismaModule],
    };
  }
}
