import {
  Controller,
  Get,
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
import type { IdentityPrincipals } from "../../facets/identity-principals/identity-principals.interface.js";
import {
  IDENTITY_PRINCIPALS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
} from "../../identity-principals.tokens.js";
import type { LogtoAccessTokenVerifier } from "../../infrastructure/idp/logto/logto-access-token-verifier.js";

@Controller("identity/subject")
@UseFilters(IdentityProblemDetailsFilter)
export class ResolveSubjectController {
  constructor(
    @Inject(IDENTITY_PRINCIPALS)
    private readonly identityPrincipals: IdentityPrincipals,
    @Inject(LOGTO_ACCESS_TOKEN_VERIFIER)
    private readonly tokenVerifier: LogtoAccessTokenVerifier,
  ) {}

  @Get()
  @ApiOperation({ summary: "Resolve a Logto proof and Platform Session into a Subject" })
  @ApiResponse({ status: 200 })
  async resolveHumanSubject(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-platform-session") sessionRef: string | undefined,
  ): Promise<object> {
    const proof = await this.tokenVerifier.verifyHumanSession(
      bearerToken(authorization),
    );
    if (!proof.ok) {
      throwProofError(proof.error.code);
    }
    const result = await this.identityPrincipals.resolveSubject({
      identity: proof.identity,
      sessionRef: sessionRef ?? "",
    });
    if (!result.ok) {
      throwIdentityError(result.error);
    }
    return { subject: result.subject };
  }

  @Get("service")
  @ApiOperation({ summary: "Resolve a service token and Platform Session into a Subject" })
  @ApiResponse({ status: 200 })
  async resolveServiceSubject(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-platform-session") sessionRef: string | undefined,
  ): Promise<object> {
    const proof = await this.tokenVerifier.verifyServiceSession(
      bearerToken(authorization),
    );
    if (!proof.ok) {
      throwProofError(proof.error.code);
    }
    const result = await this.identityPrincipals.resolveSubject({
      identity: proof.identity,
      sessionRef: sessionRef ?? "",
    });
    if (!result.ok) {
      throwIdentityError(result.error);
    }
    return { subject: result.subject };
  }
}
