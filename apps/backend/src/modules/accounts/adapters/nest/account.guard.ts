import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { ACCOUNTS, LOGTO_ACCESS_TOKEN_VERIFIER } from "../../accounts.tokens.js";
import type {
  Accounts,
  AuthenticatedAccount,
} from "../../facets/accounts/accounts.interface.js";
import type { LogtoAccessTokenVerifier } from "../../infrastructure/idp/logto/logto-access-token-verifier.js";
import { bearerToken, throwAccountError, throwProofError } from "./account-http.js";
import { currentAccountRequestProperty } from "./current-account.js";

type AuthenticatedRequest = FastifyRequest & {
  [currentAccountRequestProperty]?: AuthenticatedAccount;
};

@Injectable()
export class AccountGuard implements CanActivate {
  constructor(
    @Inject(ACCOUNTS) private readonly accounts: Accounts,
    @Inject(LOGTO_ACCESS_TOKEN_VERIFIER)
    private readonly tokenVerifier: LogtoAccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<true> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    await authenticateRequest(request, this.accounts, this.tokenVerifier);
    return true;
  }
}

@Injectable()
export class OptionalAccountGuard implements CanActivate {
  constructor(
    @Inject(ACCOUNTS) private readonly accounts: Accounts,
    @Inject(LOGTO_ACCESS_TOKEN_VERIFIER)
    private readonly tokenVerifier: LogtoAccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<true> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.headers.authorization === undefined) {
      return true;
    }
    await authenticateRequest(request, this.accounts, this.tokenVerifier);
    return true;
  }
}

async function authenticateRequest(
  request: AuthenticatedRequest,
  accounts: Accounts,
  tokenVerifier: LogtoAccessTokenVerifier,
): Promise<void> {
  const proof = await tokenVerifier.verifyAccount(
    bearerToken(headerValue(request.headers.authorization)),
  );
  if (!proof.ok) throwProofError(proof.error.code);

  const result = await accounts.resolveAccount({ identity: proof.identity });
  if (!result.ok) throwAccountError(result.error);

  request[currentAccountRequestProperty] = result.account;
}

function headerValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
