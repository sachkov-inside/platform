import {
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import type {
  Accounts,
  LogtoAccessTokenVerifier,
} from "../../modules/accounts/index.js";

export function createMcpAccountTokenVerifier(dependencies: {
  readonly accounts: Pick<Accounts, "resolveAccount">;
  readonly tokenVerifier: Pick<LogtoAccessTokenVerifier, "verifyAccount">;
}): OAuthTokenVerifier {
  const verifier: OAuthTokenVerifier = {
    async verifyAccessToken(token: string) {
      const proof = await dependencies.tokenVerifier.verifyAccount(token);
      if (!proof.ok) {
        throw proof.error.code === "invalid_proof"
          ? invalidToken("The delegated Account proof is invalid or expired")
          : serverError("The identity proof dependency is unavailable");
      }

      const account = await dependencies.accounts.resolveAccount({
        identity: proof.identity,
      });
      if (!account.ok) {
        throw account.error.code === "internal_error"
          ? serverError("The Account dependency is unavailable")
          : invalidToken("The delegated proof does not resolve an Account");
      }

      return {
        token,
        clientId: "inside-platform-user-delegation",
        scopes: [],
        expiresAt: proof.expiresAt,
        extra: { accountId: account.account.accountId },
      };
    },
  };
  return Object.freeze(verifier);
}

function invalidToken(message: string): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidToken, message);
}

function serverError(message: string): OAuthError {
  return new OAuthError(OAuthErrorCode.ServerError, message);
}
