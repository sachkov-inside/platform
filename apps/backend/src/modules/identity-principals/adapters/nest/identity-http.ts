import { HttpException, HttpStatus } from "@nestjs/common";

import type { IdentityError } from "../../facets/identity-principals/identity-principals.interface.js";

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

export function throwIdentityError(error: IdentityError): never {
  const statusByCode: Readonly<Record<IdentityError["code"], HttpStatus>> = {
    idempotency_key_reused: HttpStatus.CONFLICT,
    identity_conflict: HttpStatus.CONFLICT,
    identity_mismatch: HttpStatus.UNAUTHORIZED,
    identity_not_found: HttpStatus.UNAUTHORIZED,
    internal_error: HttpStatus.INTERNAL_SERVER_ERROR,
    invalid_input: HttpStatus.BAD_REQUEST,
    principal_disabled: HttpStatus.UNAUTHORIZED,
    reauthentication_required: HttpStatus.UNAUTHORIZED,
    session_ended: HttpStatus.UNAUTHORIZED,
    session_expired: HttpStatus.UNAUTHORIZED,
    session_not_found: HttpStatus.UNAUTHORIZED,
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
