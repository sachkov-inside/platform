import {
  MaterialContentModule,
  PublicContentTargets,
} from "../materials/index.js";
import { Module } from "@nestjs/common";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import { ACCOUNTS, AccountsModule, type Accounts } from "../accounts/index.js";
import {
  TelegramAccountLinks,
  TelegramAccountLinksModule,
} from "../telegram-membership/index.js";
import { AuthorizeCommunicationsAuthorController } from "./features/authorize-author/authorize-author.controller.js";
import { ManageCommunicationsController } from "./features/manage-communications/manage-communications.controller.js";
import { Communications } from "./facets/communications/communications.js";
import { HttpCommunicationsProvider } from "./infrastructure/http-communications-provider.js";

@Module({
  imports: [AccountsModule, TelegramAccountLinksModule, MaterialContentModule],
  controllers: [
    AuthorizeCommunicationsAuthorController,
    ManageCommunicationsController,
  ],
  exports: [Communications],
  providers: [
    {
      provide: Communications,
      inject: [
        ACCOUNTS,
        TelegramAccountLinks,
        PLATFORM_CONFIG,
        PublicContentTargets,
      ],
      useFactory: (
        accounts: Accounts,
        links: TelegramAccountLinks,
        config: PlatformConfig,
        targets: PublicContentTargets,
      ) =>
        new Communications(
          accounts,
          links,
          new HttpCommunicationsProvider(config.communications),
          {
            targets,
            publicOrigin: config.communications?.publicOrigin,
            botStartUrl: config.telegramMembership.botStartUrl,
          },
        ),
    },
  ],
})
export class CommunicationsModule {}
