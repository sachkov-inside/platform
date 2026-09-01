import { type DynamicModule, Module } from "@nestjs/common";

import { PlatformConfigModule } from "../../config/platform-config.module.js";
import type { PlatformConfig } from "../../config/platform-config.js";
import { ProfileAvatarMaintenanceModule } from "../../modules/member-profiles/index.js";

@Module({})
export class ProfileAvatarsWorkerModule {
  static forRoot(config?: PlatformConfig): DynamicModule {
    return {
      module: ProfileAvatarsWorkerModule,
      imports: [PlatformConfigModule.forRoot(config), ProfileAvatarMaintenanceModule],
    };
  }
}
