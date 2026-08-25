import { Inject, Module } from "@nestjs/common";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import {
  PLATFORM_DATABASE,
  PostgresModule,
  type PlatformDatabase,
} from "../../infrastructure/postgres/index.js";
import { IdentityController } from "./adapters/nest/identity.controller.js";
import type { IdentityPrincipals } from "./application/identity-principals.interface.js";
import { createIdentityPrincipals } from "./create-identity-principals.js";
import {
  IDENTITY_PRINCIPALS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
} from "./identity-principals.tokens.js";
import {
  createLogtoAccessTokenVerifier,
  type LogtoAccessTokenVerifier,
} from "./infrastructure/idp/logto/logto-access-token-verifier.js";

@Module({
  imports: [PostgresModule],
  controllers: [IdentityController],
  providers: [
    {
      provide: IDENTITY_PRINCIPALS,
      inject: [PLATFORM_DATABASE, PLATFORM_CONFIG],
      useFactory: (
        database: PlatformDatabase,
        config: PlatformConfig,
      ): IdentityPrincipals =>
        createIdentityPrincipals({
          database,
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
  exports: [IDENTITY_PRINCIPALS],
})
export class IdentityPrincipalsModule {
  constructor(
    @Inject(IDENTITY_PRINCIPALS) readonly identityPrincipals: IdentityPrincipals,
  ) {}
}
