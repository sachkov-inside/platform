import { Module } from "@nestjs/common";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { BeginHumanReauthenticationController } from "./features/begin-human-reauthentication/begin-human-reauthentication.controller.js";
import { CompleteHumanReauthenticationController } from "./features/complete-human-reauthentication/complete-human-reauthentication.controller.js";
import { EndSessionController } from "./features/end-session/end-session.controller.js";
import { EstablishSessionController } from "./features/establish-session/establish-session.controller.js";
import { ResolveSubjectController } from "./features/resolve-subject/resolve-subject.controller.js";
import type { IdentityPrincipals } from "./facets/identity-principals/identity-principals.interface.js";
import { assembleIdentityPrincipals } from "./facets/identity-principals/assemble-identity-principals.js";
import {
  IDENTITY_PRINCIPALS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
} from "./identity-principals.tokens.js";
import {
  createLogtoAccessTokenVerifier,
  type LogtoAccessTokenVerifier,
} from "./infrastructure/idp/logto/logto-access-token-verifier.js";

@Module({
  imports: [PrismaModule],
  controllers: [
    BeginHumanReauthenticationController,
    CompleteHumanReauthenticationController,
    EndSessionController,
    EstablishSessionController,
    ResolveSubjectController,
  ],
  providers: [
    {
      provide: IDENTITY_PRINCIPALS,
      inject: [PrismaClientProvider, PLATFORM_CONFIG],
      useFactory: (
        prisma: PrismaClientProvider,
        config: PlatformConfig,
      ): IdentityPrincipals =>
        assembleIdentityPrincipals({
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
  ],
})
export class IdentityPrincipalsModule {}
