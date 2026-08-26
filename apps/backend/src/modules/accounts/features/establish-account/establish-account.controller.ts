import { Controller, Headers, Inject, Post } from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";

import {
  AccountEndpoint,
  ApiAccountErrors,
} from "../../adapters/nest/account-endpoint.js";
import {
  bearerToken,
  throwAccountError,
  throwProofError,
} from "../../adapters/nest/account-http.js";
import { accountResponseSchema } from "../../adapters/nest/account-http.contract.js";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import type { Accounts } from "../../facets/accounts/accounts.interface.js";
import {
  ACCOUNTS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
} from "../../accounts.tokens.js";
import type { LogtoAccessTokenVerifier } from "../../infrastructure/idp/logto/logto-access-token-verifier.js";

@Controller("accounts")
@AccountEndpoint()
export class EstablishAccountController {
  constructor(
    @Inject(ACCOUNTS) private readonly accounts: Accounts,
    @Inject(LOGTO_ACCESS_TOKEN_VERIFIER)
    private readonly tokenVerifier: LogtoAccessTokenVerifier,
  ) {}

  @Post()
  @ApiOperation({
    operationId: "establishAccount",
    summary: "Establish an Account after verified Logto sign-in",
  })
  @ApiResponse({ status: 201, schema: toOpenApiSchema(accountResponseSchema) })
  @ApiAccountErrors(400, 401, 409, 500, 503)
  async establish(
    @Headers("authorization") authorization: string | undefined,
  ): Promise<object> {
    const proof = await this.tokenVerifier.verifyAccountSignIn(
      bearerToken(authorization),
    );
    if (!proof.ok) throwProofError(proof.error.code);
    const result = await this.accounts.establishAccount({
      identity: proof.identity,
    });
    if (!result.ok) throwAccountError(result.error);
    return { account: result.account };
  }
}
