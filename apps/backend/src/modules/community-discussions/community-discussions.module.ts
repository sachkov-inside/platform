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
import { CommunityDiscussions } from "./facets/community-discussions/community-discussions.js";
import { HttpCommunityDiscussionsProvider } from "./infrastructure/http-community-discussions-provider.js";

@Module({
  imports: [AccountsModule, TelegramAccountLinksModule],
  exports: [CommunityDiscussions],
  providers: [
    {
      provide: CommunityDiscussions,
      inject: [ACCOUNTS, TelegramAccountLinks, PLATFORM_CONFIG],
      useFactory: (
        accounts: Accounts,
        links: TelegramAccountLinks,
        config: PlatformConfig,
      ) =>
        new CommunityDiscussions(
          accounts,
          links,
          new HttpCommunityDiscussionsProvider(config.communityDiscussions),
        ),
    },
  ],
})
export class CommunityDiscussionsModule {}
