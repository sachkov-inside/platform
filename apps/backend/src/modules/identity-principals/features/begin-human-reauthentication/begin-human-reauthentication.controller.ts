import {
  Controller,
  Headers,
  Inject,
  Post,
  UseFilters,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";

import {
  bearerToken,
  throwIdentityError,
  throwProofError,
} from "../../adapters/nest/identity-http.js";
import { IdentityProblemDetailsFilter } from "../../adapters/nest/identity-problem-details.filter.js";
import type { IdentityPrincipals } from "../../facets/identity-principals/identity-principals.interface.js";
import {
  IDENTITY_PRINCIPALS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
} from "../../identity-principals.tokens.js";
import type { LogtoAccessTokenVerifier } from "../../infrastructure/idp/logto/logto-access-token-verifier.js";

@Controller("identity/reauthentication-attempts")
@UseFilters(IdentityProblemDetailsFilter)
export class BeginHumanReauthenticationController {
  constructor(
    @Inject(IDENTITY_PRINCIPALS)
    private readonly identityPrincipals: IdentityPrincipals,
    @Inject(LOGTO_ACCESS_TOKEN_VERIFIER)
    private readonly tokenVerifier: LogtoAccessTokenVerifier,
  ) {}

  @Post()
  @ApiOperation({ summary: "Begin re-authentication for the current human session" })
  @ApiResponse({ status: 201 })
  async beginHumanReauthentication(
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-platform-session") sessionRef: string | undefined,
  ): Promise<object> {
    const proof = await this.tokenVerifier.verifyHumanSession(
      bearerToken(authorization),
    );
    if (!proof.ok) {
      throwProofError(proof.error.code);
    }
    const result = await this.identityPrincipals.beginHumanReauthentication({
      identity: proof.identity,
      idempotencyKey: idempotencyKey ?? "",
      sessionRef: sessionRef ?? "",
    });
    if (!result.ok) {
      throwIdentityError(result.error);
    }
    return { attemptId: result.attemptId, expiresAt: result.expiresAt };
  }
}
