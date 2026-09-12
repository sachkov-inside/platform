import { NotificationAccounts } from "./facets/notification-accounts/notification-accounts.js";
import { BillingContact } from "./facets/billing-contact/billing-contact.js";
import { BillingContactController } from "./features/billing-contact/billing-contact.controller.js";
import { billingContactProtection } from "./infrastructure/billing-contact-protection.js";
import { assembleBillingContactSender } from "./infrastructure/send-billing-contact-code.js";
import { consentDocuments } from "@inside/legal";
import { Module } from "@nestjs/common";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { EstablishAccountController } from "./features/establish-account/establish-account.controller.js";
import { ResolveAccountController } from "./features/resolve-account/resolve-account.controller.js";
import { assembleAccounts } from "./facets/accounts/assemble-accounts.js";
import type { Accounts } from "./facets/accounts/accounts.interface.js";
import { ACCOUNTS, LOGTO_ACCESS_TOKEN_VERIFIER } from "./accounts.tokens.js";
import {
  createLogtoAccessTokenVerifier,
  type LogtoAccessTokenVerifier,
} from "./infrastructure/idp/logto/logto-access-token-verifier.js";
import {
  AccountGuard,
  OptionalAccountGuard,
} from "./adapters/nest/account.guard.js";

@Module({
  imports: [PrismaModule],
  controllers: [EstablishAccountController, ResolveAccountController, BillingContactController],
  providers: [
    { provide: NotificationAccounts, inject: [PrismaClientProvider, PLATFORM_CONFIG],
      useFactory: (prisma: PrismaClientProvider, config: PlatformConfig) => new NotificationAccounts(prisma,
        config.billingContact ? billingContactProtection(config.billingContact.encryptionKey) : undefined) },
    {
      provide: BillingContact,
      inject: [PrismaClientProvider, PLATFORM_CONFIG],
      useFactory: (prisma: PrismaClientProvider, config: PlatformConfig) => new BillingContact({
        prisma,
        protection: config.billingContact ? billingContactProtection(config.billingContact.encryptionKey) : undefined,
        sendCode: config.billingContact ? assembleBillingContactSender(config.billingContact) : undefined,
        // The published editions themselves; a buyer accepts the text this catalogue carries.
        documents: consentDocuments(config.publicSite.origin),
        now: () => new Date(),
      }),
    },
    {
      provide: ACCOUNTS,
      inject: [PrismaClientProvider, PLATFORM_CONFIG],
      useFactory: (
        prisma: PrismaClientProvider,
        config: PlatformConfig,
      ): Accounts =>
        assembleAccounts({
          prisma,
          emailFingerprintKey: config.identity.emailFingerprintKey,
        }),
    },
    {
      provide: LOGTO_ACCESS_TOKEN_VERIFIER,
      inject: [PLATFORM_CONFIG],
      useFactory: (config: PlatformConfig): LogtoAccessTokenVerifier =>
        createLogtoAccessTokenVerifier({
          telegramSignInEnabled: config.identity.telegramSignInEnabled,
          issuer: config.identity.issuer,
          audience: config.identity.audience,
          jwksUrl: config.identity.jwksUrl,
        }),
    },
    AccountGuard,
    OptionalAccountGuard,
  ],
  exports: [
    BillingContact,
    NotificationAccounts,
    ACCOUNTS,
    LOGTO_ACCESS_TOKEN_VERIFIER,
    AccountGuard,
    OptionalAccountGuard,
  ],
})
export class AccountsModule {}
