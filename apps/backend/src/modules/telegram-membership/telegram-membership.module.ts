import { TelegramAccountSignIn } from "./features/complete-telegram-sign-in/telegram-account-sign-in.js";
import { HttpTelegramSignInProvider } from "./features/complete-telegram-sign-in/telegram-sign-in-provider.js";
import { TelegramAccountSignInController } from "./features/complete-telegram-sign-in/telegram-account-sign-in.controller.js";
import { Module } from "@nestjs/common";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { AccountsModule, ACCOUNTS, type Accounts } from "../accounts/index.js";
import {
  MEMBERSHIP_ENTITLEMENTS,
  MembershipEntitlementsModule,
  type MembershipEntitlements,
} from "../membership-entitlements/index.js";
import { TelegramEvidenceController } from "./adapters/nest/telegram-evidence.controller.js";
import { AccountTelegramMembershipController } from "./adapters/nest/account-telegram-membership.controller.js";
import { TelegramLinkController } from "./adapters/nest/telegram-link.controller.js";
import { assembleTelegramMembership } from "./facets/telegram-membership/assemble-telegram-membership.js";
import type { TelegramMembership } from "./facets/telegram-membership/telegram-membership.interface.js";
import { HttpTelegramLinkProvider } from "./infrastructure/http/http-telegram-link-provider.js";
import type { TelegramLinkProvider } from "./ports/telegram-link-provider.js";
import {
  TELEGRAM_LINK_PROVIDER,
  TELEGRAM_MEMBERSHIP,
} from "./telegram-membership.tokens.js";

@Module({
  imports: [AccountsModule, MembershipEntitlementsModule, PrismaModule],
  controllers: [
    TelegramAccountSignInController,
    AccountTelegramMembershipController,
    TelegramLinkController,
    TelegramEvidenceController,
  ],
  providers: [
    {
      provide: TelegramAccountSignIn,
      inject: [ACCOUNTS, PrismaClientProvider, MEMBERSHIP_ENTITLEMENTS, PLATFORM_CONFIG],
      useFactory: (accounts: Accounts, prisma: PrismaClientProvider, membershipEntitlements: MembershipEntitlements, config: PlatformConfig) => new TelegramAccountSignIn({
        accounts, prisma, membershipEntitlements,
        provider: new HttpTelegramSignInProvider(config.identity.telegramSignInProviderUrl, config.identity.telegramSignInIntegrationSecret),
      }),
    },
    {
      provide: TELEGRAM_LINK_PROVIDER,
      inject: [PLATFORM_CONFIG],
      useFactory: (config: PlatformConfig): TelegramLinkProvider =>
        new HttpTelegramLinkProvider(
          config.telegramMembership.linkingEndpoint,
          config.telegramMembership.linkingSecret,
        ),
    },
    {
      provide: TELEGRAM_MEMBERSHIP,
      inject: [
        PrismaClientProvider,
        MEMBERSHIP_ENTITLEMENTS,
        TELEGRAM_LINK_PROVIDER,
        PLATFORM_CONFIG,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        membershipEntitlements: MembershipEntitlements,
        provider: TelegramLinkProvider,
        config: PlatformConfig,
      ): TelegramMembership =>
        assembleTelegramMembership({
          botStartUrl: config.telegramMembership.botStartUrl,
          linkLifetimeMs: config.telegramMembership.linkLifetimeMs,
          membershipAcquisitionUrl:
            config.contentAccess.membershipAcquisitionUrl,
          membershipEntitlements,
          ...(config.telegramMembership.supportUrl === undefined
            ? {}
            : { membershipSupportUrl: config.telegramMembership.supportUrl }),
          prisma,
          provider,
        }),
    },
  ],
})
export class TelegramMembershipModule {}
