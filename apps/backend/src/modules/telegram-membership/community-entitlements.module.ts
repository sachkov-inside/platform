import { Module } from "@nestjs/common";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { ACCOUNTS, AccountsModule, type Accounts } from "../accounts/index.js";
import {
  ACCESS_GRANTS,
  MembershipEntitlementsModule,
  type AccessGrants,
} from "../membership-entitlements/index.js";
import { CommunityDeliveryController } from "./adapters/nest/community-delivery.controller.js";
import { CommunityDispatchController } from "./adapters/nest/community-dispatch.controller.js";
import { CommunityEntitlements } from "./facets/community-entitlements/community-entitlements.js";
import { TelegramAccountLinks } from "./facets/telegram-account-links/telegram-account-links.js";
import { HttpCommunityEntitlementProvider } from "./infrastructure/http/http-community-entitlement-provider.js";
import { disabledCommunityEntitlementProvider } from "./ports/community-entitlement-provider.js";
import { TelegramAccountLinksModule } from "./telegram-account-links.module.js";

@Module({
  imports: [
    PrismaModule,
    AccountsModule,
    MembershipEntitlementsModule,
    TelegramAccountLinksModule,
  ],
  controllers: [CommunityDispatchController, CommunityDeliveryController],
  providers: [
    {
      provide: CommunityEntitlements,
      inject: [
        PrismaClientProvider,
        ACCOUNTS,
        ACCESS_GRANTS,
        TelegramAccountLinks,
        PLATFORM_CONFIG,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        grants: AccessGrants,
        links: TelegramAccountLinks,
        config: PlatformConfig,
      ) =>
        new CommunityEntitlements({
          accounts,
          grants,
          links,
          prisma,
          provider: config.communityEntitlements
            ? new HttpCommunityEntitlementProvider(
                config.communityEntitlements.endpoint,
                config.communityEntitlements.providerSecret,
              )
            : disabledCommunityEntitlementProvider,
        }),
    },
  ],
  exports: [CommunityEntitlements],
})
export class CommunityEntitlementsModule {}
