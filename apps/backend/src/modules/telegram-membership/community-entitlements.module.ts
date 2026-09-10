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
import { assembleAccessGrants } from "../membership-entitlements/index.js";
import { CommunityDeliveryController } from "./adapters/nest/community-delivery.controller.js";
import { CommunityDispatchController } from "./adapters/nest/community-dispatch.controller.js";
import { CommunityEntitlements } from "./facets/community-entitlements/community-entitlements.js";
import { TelegramAccountLinks } from "./facets/telegram-account-links/telegram-account-links.js";
import { HttpCommunityEntitlementProvider } from "./infrastructure/http/http-community-entitlement-provider.js";
import { disabledCommunityEntitlementProvider } from "./ports/community-entitlement-provider.js";
import { TelegramAccountLinksModule } from "./telegram-account-links.module.js";

// Community projection reads access through the same public grant facet billing uses.
const COMMUNITY_GRANTS = Symbol("CommunityAccessGrants");
type CommunityGrants = ReturnType<typeof assembleAccessGrants>;

@Module({
  imports: [PrismaModule, AccountsModule, TelegramAccountLinksModule],
  controllers: [CommunityDispatchController, CommunityDeliveryController],
  providers: [
    {
      provide: COMMUNITY_GRANTS,
      inject: [PrismaClientProvider, ACCOUNTS],
      useFactory: (prisma: PrismaClientProvider, accounts: Accounts) =>
        assembleAccessGrants({ accounts, prisma }),
    },
    {
      provide: CommunityEntitlements,
      inject: [
        PrismaClientProvider,
        ACCOUNTS,
        COMMUNITY_GRANTS,
        TelegramAccountLinks,
        PLATFORM_CONFIG,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        accounts: Accounts,
        grants: CommunityGrants,
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
