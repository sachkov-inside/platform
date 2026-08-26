import { HttpException, HttpStatus } from "@nestjs/common";

import type { AccountError } from "../../facets/accounts/accounts.interface.js";

export function bearerToken(value: string | undefined): string {
  const match = /^Bearer ([^\s]+)$/u.exec(value ?? "");
  if (match?.[1] === undefined) {
    throw new HttpException({ code: "invalid_proof" }, HttpStatus.UNAUTHORIZED);
  }
  return match[1];
}

export function throwProofError(
  code: "dependency_unavailable" | "invalid_proof",
): never {
  throw new HttpException(
    { code },
    code === "dependency_unavailable"
      ? HttpStatus.SERVICE_UNAVAILABLE
      : HttpStatus.UNAUTHORIZED,
  );
}

export function throwAccountError(error: AccountError): never {
  const statusByCode: Readonly<Record<AccountError["code"], HttpStatus>> = {
    account_not_found: HttpStatus.UNAUTHORIZED,
    identity_conflict: HttpStatus.CONFLICT,
    internal_error: HttpStatus.INTERNAL_SERVER_ERROR,
    invalid_input: HttpStatus.BAD_REQUEST,
  };
  throw new HttpException(
    {
      code: error.code,
      ...(error.code === "internal_error"
        ? { correlationId: error.correlationId }
        : {}),
    },
    statusByCode[error.code],
  );
}
