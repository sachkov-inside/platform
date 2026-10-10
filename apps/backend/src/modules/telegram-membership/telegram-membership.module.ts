import { CommunityEntitlementsModule } from "./community-entitlements.module.js";
import { CommunityEntitlements } from "./facets/community-entitlements/community-entitlements.js";
import { SubscriptionActivationController } from "./features/activate-subscription/subscription-activation.controller.js";
import { InvitationRedemptionController } from "./features/redeem-invitation/invitation-redemption.controller.js";
import { TelegramAccountLinks } from "./facets/telegram-account-links/telegram-account-links.js";
import { TelegramAccountLinksModule } from "./telegram-account-links.module.js";
import { TelegramAccountSignIn } from "./features/complete-telegram-sign-in/telegram-account-sign-in.js";
import { HttpTelegramSignInProvider } from "./features/complete-telegram-sign-in/telegram-sign-in-provider.js";
import { TelegramAccountSignInController } from "./features/complete-telegram-sign-in/telegram-account-sign-in.controller.js";
import { ResumeTelegramAccountSignInController } from "./features/complete-telegram-sign-in/resume-telegram-account-sign-in.controller.js";
import { Module } from "@nestjs/common";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import {
  AccountsModule,
  ACCOUNTS,
  LegalAcceptances,
  type Accounts,
} from "../accounts/index.js";
import {
  BillingModule,
  BillingPricing,
  SubscriptionActivation,
} from "../billing/index.js";
import {
  ACCESS_GRANTS,
  type AccessGrants,
  ACCOUNT_RIGHTS,
  AccountRightsModule,
  type AccountRights,
} from "../account-rights/index.js";
import { TelegramEvidenceController } from "./adapters/nest/telegram-evidence.controller.js";
import { AccountTelegramMembershipController } from "./adapters/nest/account-telegram-membership.controller.js";
import { TelegramLinkController } from "./adapters/nest/telegram-link.controller.js";
import { PendingLinkConfirmationPump } from "./adapters/nest/pending-link-confirmation.pump.js";
import { assembleTelegramMembership } from "./facets/telegram-membership/assemble-telegram-membership.js";
import type { TelegramMembership } from "./facets/telegram-membership/telegram-membership.interface.js";
import { HttpTelegramLinkProvider } from "./infrastructure/http/http-telegram-link-provider.js";
import type { TelegramLinkProvider } from "./ports/telegram-link-provider.js";
import {
  TELEGRAM_LINK_PROVIDER,
  TELEGRAM_MEMBERSHIP,
} from "./telegram-membership.tokens.js";

@Module({
  imports: [
    AccountsModule,
    AccountRightsModule,
    PrismaModule,
    BillingModule,
    TelegramAccountLinksModule,
    CommunityEntitlementsModule,
  ],
  controllers: [
    SubscriptionActivationController,
    InvitationRedemptionController,
    TelegramAccountSignInController,
    ResumeTelegramAccountSignInController,
    AccountTelegramMembershipController,
    TelegramLinkController,
    TelegramEvidenceController,
  ],
  providers: [
    PendingLinkConfirmationPump,
    {
      provide: SubscriptionActivation,
      inject: [
        PrismaClientProvider,
        ACCESS_GRANTS,
        TelegramAccountLinks,
        CommunityEntitlements,
        PLATFORM_CONFIG,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        grants: AccessGrants,
        bindings: TelegramAccountLinks,
        community: CommunityEntitlements,
        config: PlatformConfig,
      ) =>
        new SubscriptionActivation({
          prisma,
          grants,
          bindings,
          readAdmission: (accountId) => community.readOwnAdmission(accountId),
          siteOrigin: config.publicSite.origin,
        }),
    },
    {
      provide: TelegramAccountSignIn,
      inject: [
        ACCOUNTS,
        PrismaClientProvider,
        ACCOUNT_RIGHTS,
        PLATFORM_CONFIG,
        LegalAcceptances,
      ],
      useFactory: (
        accounts: Accounts,
        prisma: PrismaClientProvider,
        accountRights: AccountRights,
        config: PlatformConfig,
        terms: LegalAcceptances,
      ) =>
        new TelegramAccountSignIn({
          accounts,
          prisma,
          accountRights,
          terms,
          provider: new HttpTelegramSignInProvider(
            config.identity.telegramSignInProviderUrl,
            config.identity.telegramSignInIntegrationSecret,
          ),
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
        ACCOUNT_RIGHTS,
        TELEGRAM_LINK_PROVIDER,
        PLATFORM_CONFIG,
        BillingPricing,
      ],
      useFactory: (
        prisma: PrismaClientProvider,
        accountRights: AccountRights,
        provider: TelegramLinkProvider,
        config: PlatformConfig,
        pricing: BillingPricing,
      ): TelegramMembership =>
        assembleTelegramMembership({
          botStartUrl: config.telegramMembership.botStartUrl,
          linkLifetimeMs: config.telegramMembership.linkLifetimeMs,
          subscriptionForSale: (accountId) =>
            pricing.hasOffersForSale(accountId),
          accountRights,
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
