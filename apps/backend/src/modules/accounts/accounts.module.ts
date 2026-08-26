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
import { AccountGuard } from "./adapters/nest/account.guard.js";

@Module({
  imports: [PrismaModule],
  controllers: [EstablishAccountController, ResolveAccountController],
  providers: [
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
          issuer: config.identity.issuer,
          audience: config.identity.audience,
          jwksUrl: config.identity.jwksUrl,
        }),
    },
    AccountGuard,
  ],
  exports: [ACCOUNTS, LOGTO_ACCESS_TOKEN_VERIFIER, AccountGuard],
})
export class AccountsModule {}
