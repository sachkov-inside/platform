import { type DynamicModule, Module } from "@nestjs/common";

import { PlatformConfigModule } from "../../config/platform-config.module.js";
import type { PlatformConfig } from "../../config/platform-config.js";
import { OperationalReadiness } from "../../infrastructure/operational-readiness.js";
import { PostgresModule } from "../../infrastructure/postgres/index.js";
import { IdentityPrincipalsModule } from "../../modules/identity-principals/index.js";
import { MaterialsModule } from "../../modules/materials/index.js";
import { HealthController } from "./health.controller.js";
import { PublishedMaterialsController } from "./published-materials.controller.js";

@Module({
  controllers: [HealthController, PublishedMaterialsController],
  providers: [OperationalReadiness],
})
export class ApiModule {
  static forRoot(config: PlatformConfig): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        PlatformConfigModule.forRoot(config),
        PostgresModule,
        IdentityPrincipalsModule,
        MaterialsModule,
      ],
    };
  }
}
