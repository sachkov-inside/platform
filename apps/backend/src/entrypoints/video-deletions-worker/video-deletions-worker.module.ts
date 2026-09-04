import { type DynamicModule, Module } from "@nestjs/common";

import { PlatformConfigModule } from "../../config/platform-config.module.js";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { OperationalReadiness } from "../../infrastructure/operational-readiness.js";
import { RuntimeIdentityModule } from "../../infrastructure/runtime-identity.js";
import { MaterialContentModule } from "../../modules/materials/index.js";
import {
  assembleVideoDeletionMaintenance,
  createConfiguredVideoProvider,
  VIDEO_DELETION_MAINTENANCE,
  type VideoDeletionMaintenance,
} from "../../modules/videos/index.js";

@Module({})
export class VideoDeletionsWorkerModule {
  static forRoot(config?: PlatformConfig): DynamicModule {
    return {
      module: VideoDeletionsWorkerModule,
      imports: [
        PlatformConfigModule.forRoot(config, "video-deletions-worker"),
        RuntimeIdentityModule,
        PrismaModule,
        MaterialContentModule,
      ],
      providers: [OperationalReadiness, {
        provide: VIDEO_DELETION_MAINTENANCE,
        inject: [PrismaClientProvider, PLATFORM_CONFIG],
        useFactory: (
          prisma: PrismaClientProvider,
          platformConfig: PlatformConfig,
        ): VideoDeletionMaintenance => assembleVideoDeletionMaintenance({
          prisma,
          provider: createConfiguredVideoProvider(platformConfig),
          reportFailure(event) {
            console.error(JSON.stringify({
              process: "video-deletions-worker",
              status: "operator_attention",
              ...event,
            }));
          },
        }),
      }],
      exports: [VIDEO_DELETION_MAINTENANCE],
    };
  }
}
