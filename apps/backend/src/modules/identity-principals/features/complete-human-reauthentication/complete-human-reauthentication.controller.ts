import {
  Controller,
  Headers,
  Inject,
  Param,
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
export class CompleteHumanReauthenticationController {
  constructor(
    @Inject(IDENTITY_PRINCIPALS)
    private readonly identityPrincipals: IdentityPrincipals,
    @Inject(LOGTO_ACCESS_TOKEN_VERIFIER)
    private readonly tokenVerifier: LogtoAccessTokenVerifier,
  ) {}

  @Post(":attemptId/complete")
  @ApiOperation({ summary: "Complete a fresh human re-authentication attempt" })
  @ApiResponse({ status: 201 })
  async completeHumanReauthentication(
    @Param("attemptId") attemptId: string,
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-platform-session") sessionRef: string | undefined,
  ): Promise<object> {
    const proof = await this.tokenVerifier.verifyHumanReauthentication(
      bearerToken(authorization),
      attemptId,
    );
    if (!proof.ok) {
      throwProofError(proof.error.code);
    }
    const result = await this.identityPrincipals.completeHumanReauthentication({
      proof: proof.proof,
      idempotencyKey: idempotencyKey ?? "",
      sessionRef: sessionRef ?? "",
    });
    if (!result.ok) {
      throwIdentityError(result.error);
    }
    return { subject: result.subject };
  }
}
