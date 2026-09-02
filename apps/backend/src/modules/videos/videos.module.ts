import { Module } from "@nestjs/common";

import { PLATFORM_CONFIG, type PlatformConfig } from "../../config/platform-config.js";
import { PrismaClientProvider, PrismaModule } from "../../infrastructure/prisma/index.js";
import { ACCOUNTS, AccountsModule, accountId, type Accounts } from "../accounts/index.js";
import { assembleCurrentAccountPermissions } from "../content-access/index.js";
import { assembleVideos } from "./facets/videos/assemble-videos.js";
import type { Videos } from "./facets/videos/videos.interface.js";
import { createConfiguredVideoProvider } from "./shared/configured-video-provider.js";

export const VIDEOS = Symbol("VIDEOS");

@Module({
  imports: [PrismaModule, AccountsModule],
  providers: [{
    provide: VIDEOS,
    inject: [PrismaClientProvider, ACCOUNTS, PLATFORM_CONFIG],
    useFactory: (
      prisma: PrismaClientProvider,
      accounts: Accounts,
      config: PlatformConfig,
    ): Videos => {
      const permissions = assembleCurrentAccountPermissions(accounts);
      const provider = createConfiguredVideoProvider(config);
      return assembleVideos({
        canManage: (actor) => permissions.hasMaterialsManage(accountId(actor)),
        prisma,
        provider,
        projects: {
          free: config.kinescope.publicProjectId,
          membership: config.kinescope.membershipProjectId,
        },
      });
    },
  }],
  exports: [VIDEOS],
})
export class VideosModule {}
