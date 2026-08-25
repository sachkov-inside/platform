import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseFilters,
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";

import type {
  IdentityError,
  IdentityPrincipals,
  VerifiedSessionIdentity,
} from "../../application/identity-principals.interface.js";
import type { LogtoAccessTokenVerifier } from "../../infrastructure/idp/logto/logto-access-token-verifier.js";
import {
  IDENTITY_PRINCIPALS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
} from "../../identity-principals.tokens.js";
import { IdentityProblemDetailsFilter } from "./identity-problem-details.filter.js";

@Controller("identity")
@UseFilters(IdentityProblemDetailsFilter)
export class IdentityController {
  constructor(
    @Inject(IDENTITY_PRINCIPALS)
    private readonly identityPrincipals: IdentityPrincipals,
    @Inject(LOGTO_ACCESS_TOKEN_VERIFIER)
    private readonly tokenVerifier: LogtoAccessTokenVerifier,
  ) {}

  @Post("sessions/human")
  @ApiOperation({ summary: "Establish a human Platform Session from a Logto proof" })
  @ApiResponse({ status: 201 })
  async establishHumanSession(
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ): Promise<object> {
    const token = bearerToken(authorization);
    const proof = await this.tokenVerifier.verifyHumanSignIn(token);
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

  @Post("sessions/service")
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

  @Get("subject")
  @ApiOperation({ summary: "Resolve a Logto proof and Platform Session into a Subject" })
  @ApiResponse({ status: 200 })
  async resolveSubject(
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

  @Get("subject/service")
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

  @Post("reauthentication-attempts")
  @ApiOperation({ summary: "Begin re-authentication for the current human session" })
  @ApiResponse({ status: 201 })
  async beginHumanReauthentication(
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
    const result = await this.identityPrincipals.beginHumanReauthentication({
      identity: proof.identity,
      idempotencyKey: idempotencyKey ?? "",
      sessionRef: sessionRef ?? "",
    });
    if (!result.ok) {
      throwIdentityError(result.error);
    }
    return { attemptId: result.attemptId, expiresAt: result.expiresAt };
  }

  @Post("reauthentication-attempts/:attemptId/complete")
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

  @Delete("sessions/current")
  @ApiOperation({ summary: "End the current local Platform Session" })
  @ApiResponse({ status: 200 })
  async endSession(
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

  @Delete("sessions/service/current")
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

function bearerToken(value: string | undefined): string {
  const match = /^Bearer ([^\s]+)$/u.exec(value ?? "");
  if (match?.[1] === undefined) {
    throw new HttpException({ code: "invalid_proof" }, HttpStatus.UNAUTHORIZED);
  }
  return match[1];
}

function throwProofError(code: "dependency_unavailable" | "invalid_proof"): never {
  throw new HttpException(
    { code },
    code === "dependency_unavailable"
      ? HttpStatus.SERVICE_UNAVAILABLE
      : HttpStatus.UNAUTHORIZED,
  );
}

function throwIdentityError(error: IdentityError): never {
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
