import { type DynamicModule, Module } from "@nestjs/common";

import { PlatformConfigModule } from "../../config/platform-config.module.js";
import type { PlatformConfig } from "../../config/platform-config.js";
import { OperationalReadiness } from "../../infrastructure/operational-readiness.js";
import { PostgresModule } from "../../infrastructure/postgres/index.js";
import { ContentLibraryModule } from "../../modules/content-library/index.js";
import { MaterialsModule } from "../../modules/materials/index.js";
import { ContentLibraryController } from "./content-library.controller.js";
import { HealthController } from "./health.controller.js";
import { PublishedMaterialsController } from "./published-materials.controller.js";

@Module({
  controllers: [
    ContentLibraryController,
    HealthController,
    PublishedMaterialsController,
  ],
  providers: [OperationalReadiness],
})
export class ApiModule {
  static forRoot(config: PlatformConfig): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        PlatformConfigModule.forRoot(config),
        PostgresModule,
        ContentLibraryModule,
        MaterialsModule,
      ],
    };
  }
}
