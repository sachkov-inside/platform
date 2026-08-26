import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
import { z } from "zod";

import {
  verifiedAccountIdentity,
  verifiedAccountSignIn,
  type VerifiedAccountIdentity,
} from "../../../facets/accounts/verified-logto-identity.js";

const ACCESS_TOKEN_MAX_AGE_MINUTES = 5;
const MAX_ACCESS_TOKEN_LIFETIME_SECONDS = minutesInSeconds(
  ACCESS_TOKEN_MAX_AGE_MINUTES,
);
const TOKEN_CLOCK_TOLERANCE_SECONDS = 30;
const MAX_TOKEN_LENGTH = 16_384;
const REMOTE_JWKS_CACHE_LIFETIME_MS = minutesInMilliseconds(10);
const REMOTE_JWKS_REQUEST_TIMEOUT_MS = secondsInMilliseconds(2);
const REMOTE_JWKS_COOLDOWN_MS = secondsInMilliseconds(30);
const verifiedEmailSchema = z.email().max(320);

type ProofErrorCode = "dependency_unavailable" | "invalid_proof";
type ProofFailure = {
  readonly ok: false;
  readonly error: { readonly code: ProofErrorCode };
};

export interface LogtoAccessTokenVerifier {
  verifyAccountSignIn(token: unknown): Promise<
    | ({ readonly ok: true } & ReturnType<typeof verifiedAccountSignIn>)
    | ProofFailure
  >;
  verifyAccount(token: unknown): Promise<
    | { readonly ok: true; readonly identity: VerifiedAccountIdentity }
    | ProofFailure
  >;
}

interface LogtoVerifierConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwks?: JSONWebKeySet;
  readonly jwksUrl?: string;
}

export function createLogtoAccessTokenVerifier(
  config: LogtoVerifierConfig,
): LogtoAccessTokenVerifier {
  const keyResolver = createKeyResolver(config);
  const verifier: LogtoAccessTokenVerifier = {
    async verifyAccountSignIn(token) {
      const verified = await verifyToken(token, config, keyResolver);
      if (!verified.ok) return verified;
      const email = verifiedEmailSchema.safeParse(
        verified.payload.inside_verified_email,
      );
      if (isMachineToken(verified.payload) || !email.success) {
        return invalidProof();
      }
      return {
        ok: true,
        ...verifiedAccountSignIn({
          issuer: verified.payload.iss,
          subject: verified.payload.sub,
          verifiedEmail: email.data,
        }),
      };
    },
    async verifyAccount(token) {
      const verified = await verifyToken(token, config, keyResolver);
      if (!verified.ok || isMachineToken(verified.payload)) {
        return verified.ok ? invalidProof() : verified;
      }
      return {
        ok: true,
        identity: verifiedAccountIdentity({
          issuer: verified.payload.iss,
          subject: verified.payload.sub,
        }),
      };
    },
  };
  return Object.freeze(verifier);
}

type ValidatedPayload = JWTPayload & {
  readonly iss: string;
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
};

async function verifyToken(
  token: unknown,
  config: LogtoVerifierConfig,
  keyResolver: JWTVerifyGetKey,
): Promise<{ readonly ok: true; readonly payload: ValidatedPayload } | ProofFailure> {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return invalidProof();
  }
  try {
    const { payload } = await jwtVerify(token, keyResolver, {
      algorithms: ["ES384"],
      issuer: config.issuer,
      audience: config.audience,
      clockTolerance: TOKEN_CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ["iss", "aud", "sub", "iat", "exp"],
    });
    if (
      typeof payload.iss !== "string" ||
      payload.aud !== config.audience ||
      typeof payload.sub !== "string" ||
      payload.sub.length === 0 ||
      payload.sub.length > 500 ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.iat > currentTimeInSeconds() + TOKEN_CLOCK_TOLERANCE_SECONDS ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > MAX_ACCESS_TOKEN_LIFETIME_SECONDS
    ) {
      return invalidProof();
    }
    return {
      ok: true,
      payload: {
        ...payload,
        iss: payload.iss,
        sub: payload.sub,
        iat: payload.iat,
        exp: payload.exp,
      },
    };
  } catch (error) {
    return isDependencyFailure(error, config.jwksUrl !== undefined)
      ? { ok: false, error: { code: "dependency_unavailable" } }
      : invalidProof();
  }
}

function createKeyResolver(config: LogtoVerifierConfig): JWTVerifyGetKey {
  if ((config.jwks === undefined) === (config.jwksUrl === undefined)) {
    throw new TypeError("exactly one of jwks or jwksUrl is required");
  }
  if (config.jwks !== undefined) return createLocalJWKSet(config.jwks);
  const jwksUrl = new URL(config.jwksUrl ?? "");
  if (jwksUrl.protocol !== "https:" && jwksUrl.hostname !== "127.0.0.1") {
    throw new TypeError("jwksUrl must use HTTPS outside loopback development");
  }
  return createRemoteJWKSet(jwksUrl, {
    timeoutDuration: REMOTE_JWKS_REQUEST_TIMEOUT_MS,
    cooldownDuration: REMOTE_JWKS_COOLDOWN_MS,
    cacheMaxAge: REMOTE_JWKS_CACHE_LIFETIME_MS,
  });
}

function isMachineToken(payload: ValidatedPayload): boolean {
  return payload.client_id === payload.sub;
}

function invalidProof(): ProofFailure {
  return { ok: false, error: { code: "invalid_proof" } };
}

function isDependencyFailure(error: unknown, remoteJwks: boolean): boolean {
  if (!(error instanceof Error)) return false;
  if ("code" in error && error.code === "ERR_JWKS_TIMEOUT") return true;
  if (!remoteJwks) return false;
  return (
    error instanceof TypeError ||
    ("code" in error &&
      error.code === "ERR_JOSE_GENERIC" &&
      error.message.includes("JSON Web Key Set HTTP response"))
  );
}

function minutesInSeconds(minutes: number): number {
  return minutes * 60;
}

function minutesInMilliseconds(minutes: number): number {
  return minutesInSeconds(minutes) * 1_000;
}

function secondsInMilliseconds(seconds: number): number {
  return seconds * 1_000;
}

function currentTimeInSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}
