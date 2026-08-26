import {
  Controller,
  Delete,
  Headers,
  Inject,
  UseFilters,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";

import {
  bearerToken,
  throwIdentityError,
  throwProofError,
} from "../../adapters/nest/identity-http.js";
import { IdentityProblemDetailsFilter } from "../../adapters/nest/identity-problem-details.filter.js";
import type {
  IdentityPrincipals,
  VerifiedSessionIdentity,
} from "../../facets/identity-principals/identity-principals.interface.js";
import {
  IDENTITY_PRINCIPALS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
} from "../../identity-principals.tokens.js";
import type { LogtoAccessTokenVerifier } from "../../infrastructure/idp/logto/logto-access-token-verifier.js";

@Controller("identity/sessions")
@UseFilters(IdentityProblemDetailsFilter)
export class EndSessionController {
  constructor(
    @Inject(IDENTITY_PRINCIPALS)
    private readonly identityPrincipals: IdentityPrincipals,
    @Inject(LOGTO_ACCESS_TOKEN_VERIFIER)
    private readonly tokenVerifier: LogtoAccessTokenVerifier,
  ) {}

  @Delete("current")
  @ApiOperation({ summary: "End the current local Platform Session" })
  @ApiResponse({ status: 200 })
  async endHumanSession(
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
    return this.endVerifiedSession(
      proof.identity,
      idempotencyKey ?? "",
      sessionRef ?? "",
    );
  }

  @Delete("service/current")
  @ApiOperation({ summary: "End the current service Platform Session" })
  @ApiResponse({ status: 200 })
  async endServiceSession(
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-platform-session") sessionRef: string | undefined,
  ): Promise<object> {
    const proof = await this.tokenVerifier.verifyServiceSession(
      bearerToken(authorization),
    );
    if (!proof.ok) {
      throwProofError(proof.error.code);
    }
    return this.endVerifiedSession(
      proof.identity,
      idempotencyKey ?? "",
      sessionRef ?? "",
    );
  }

  private async endVerifiedSession(
    identity: VerifiedSessionIdentity,
    idempotencyKey: string,
    sessionRef: string,
  ): Promise<object> {
    const result = await this.identityPrincipals.endSession({
      identity,
      idempotencyKey,
      sessionRef,
    });
    if (!result.ok) {
      throwIdentityError(result.error);
    }
    return { ended: true };
  }
}
