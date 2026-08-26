import { Controller, Get, Headers, Inject } from "@nestjs/common";
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

@Controller("accounts/current")
@AccountEndpoint()
export class ResolveAccountController {
  constructor(
    @Inject(ACCOUNTS) private readonly accounts: Accounts,
    @Inject(LOGTO_ACCESS_TOKEN_VERIFIER)
    private readonly tokenVerifier: LogtoAccessTokenVerifier,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "resolveCurrentAccount",
    summary: "Resolve an existing Account from a Logto access token",
  })
  @ApiResponse({ status: 200, schema: toOpenApiSchema(accountResponseSchema) })
  @ApiAccountErrors(400, 401, 500, 503)
  async resolve(
    @Headers("authorization") authorization: string | undefined,
  ): Promise<object> {
    const proof = await this.tokenVerifier.verifyAccount(
      bearerToken(authorization),
    );
    if (!proof.ok) throwProofError(proof.error.code);
    const result = await this.accounts.resolveAccount({
      identity: proof.identity,
    });
    if (!result.ok) throwAccountError(result.error);
    return { account: result.account };
  }
}
