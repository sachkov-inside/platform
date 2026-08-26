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

@Controller("identity/sessions")
@UseFilters(IdentityProblemDetailsFilter)
export class EstablishSessionController {
  constructor(
    @Inject(IDENTITY_PRINCIPALS)
    private readonly identityPrincipals: IdentityPrincipals,
    @Inject(LOGTO_ACCESS_TOKEN_VERIFIER)
    private readonly tokenVerifier: LogtoAccessTokenVerifier,
  ) {}

  @Post("human")
  @ApiOperation({ summary: "Establish a human Platform Session from a Logto proof" })
  @ApiResponse({ status: 201 })
  async establishHumanSession(
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<object> {
    const proof = await this.tokenVerifier.verifyHumanSignIn(
      bearerToken(authorization),
    );
    if (!proof.ok) {
      throwProofError(proof.error.code);
    }
    const result = await this.identityPrincipals.establishHumanSession({
      identity: proof.identity,
      idempotencyKey: idempotencyKey ?? "",
    });
    if (!result.ok) {
      throwIdentityError(result.error);
    }
    return { subject: result.subject };
  }

  @Post("service")
  @ApiOperation({ summary: "Establish a pre-provisioned service Platform Session" })
  @ApiResponse({ status: 201 })
  async establishServiceSession(
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<object> {
    const proof = await this.tokenVerifier.verifyServiceSession(
      bearerToken(authorization),
    );
    if (!proof.ok) {
      throwProofError(proof.error.code);
    }
    const result = await this.identityPrincipals.establishServiceSession({
      identity: proof.identity,
      idempotencyKey: idempotencyKey ?? "",
    });
    if (!result.ok) {
      throwIdentityError(result.error);
    }
    return { subject: result.subject };
  }
}
