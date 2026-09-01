import { type DynamicModule, Module } from "@nestjs/common";

import { PlatformConfigModule } from "../../config/platform-config.module.js";
import type { PlatformConfig } from "../../config/platform-config.js";
import { MaterialAssetMaintenanceModule } from "../../modules/materials/index.js";

@Module({})
export class MaterialAssetsWorkerModule {
  static forRoot(config: PlatformConfig): DynamicModule {
    return {
      module: MaterialAssetsWorkerModule,
      imports: [PlatformConfigModule.forRoot(config), MaterialAssetMaintenanceModule],
    };
  }
}
