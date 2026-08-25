import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

import {
  verifiedHumanReauthentication,
  verifiedHumanSignIn,
  verifiedHumanSessionIdentity,
  verifiedServiceSessionIdentity,
  type VerifiedHumanSessionIdentity,
} from "../../../application/verified-external-identity.js";

const MAX_ACCESS_TOKEN_LIFETIME_SECONDS = 5 * 60;
const MAX_TOKEN_LENGTH = 16_384;
const MAX_INTERACTIVE_IAT_SKEW_SECONDS = 60;

type ProofErrorCode = "dependency_unavailable" | "invalid_proof";

type ProofFailure = {
  readonly ok: false;
  readonly error: { readonly code: ProofErrorCode };
};

export interface LogtoAccessTokenVerifier {
  verifyHumanSignIn(token: unknown): Promise<
    | ({ readonly ok: true } & ReturnType<typeof verifiedHumanSignIn>)
    | ProofFailure
  >;
  verifyHumanSession(token: unknown): Promise<
    | { readonly ok: true; readonly identity: VerifiedHumanSessionIdentity }
    | ProofFailure
  >;
  verifyServiceSession(token: unknown): Promise<
    | {
        readonly ok: true;
        readonly identity: ReturnType<typeof verifiedServiceSessionIdentity>;
      }
    | ProofFailure
  >;
  verifyHumanReauthentication(
    token: unknown,
    attemptId: string,
  ): Promise<
    | {
        readonly ok: true;
        readonly proof: ReturnType<typeof verifiedHumanReauthentication>;
      }
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

  const implementation: LogtoAccessTokenVerifier = {
    async verifyHumanSignIn(token) {
      const verified = await verifyToken(token, config, keyResolver);
      if (!verified.ok) {
        return verified;
      }
      const email = verified.payload.inside_verified_email;
      const interactiveAt = interactiveTimestamp(verified.payload);
      if (
        verified.payload.client_id === verified.payload.sub ||
        !validVerifiedEmail(email) ||
        interactiveAt === undefined
      ) {
        return invalidProof();
      }

      return {
        ok: true,
        ...verifiedHumanSignIn({
          issuer: verified.payload.iss,
          subject: verified.payload.sub,
          authenticatedAt: interactiveAt,
          verifiedEmail: email,
        }),
      };
    },

    async verifyHumanSession(token) {
      const verified = await verifyToken(token, config, keyResolver);
      if (!verified.ok) {
        return verified;
      }
      if (verified.payload.client_id === verified.payload.sub) {
        return invalidProof();
      }

      return {
        ok: true,
        identity: humanSessionIdentity(
          verified.payload.iss,
          verified.payload.sub,
        ),
      };
    },

    async verifyServiceSession(token) {
      const verified = await verifyToken(token, config, keyResolver);
      if (
        !verified.ok ||
        typeof verified.payload.client_id !== "string" ||
        verified.payload.client_id !== verified.payload.sub
      ) {
        return verified.ok ? invalidProof() : verified;
      }
      return {
        ok: true,
        identity: verifiedServiceSessionIdentity({
          issuer: verified.payload.iss,
          subject: verified.payload.sub,
          authenticatedAt: new Date(verified.payload.iat * 1_000).toISOString(),
        }),
      };
    },

    async verifyHumanReauthentication(token, attemptId) {
      if (!validUuid(attemptId)) {
        return invalidProof();
      }
      const verified = await verifyToken(token, config, keyResolver);
      if (!verified.ok) {
        return verified;
      }
      const interactiveAt = interactiveTimestamp(verified.payload);
      if (
        verified.payload.client_id === verified.payload.sub ||
        interactiveAt === undefined ||
        typeof verified.payload.jti !== "string"
      ) {
        return invalidProof();
      }

      return {
        ok: true,
        proof: verifiedHumanReauthentication({
          issuer: verified.payload.iss,
          subject: verified.payload.sub,
          reauthenticatedAt: interactiveAt,
          attemptId,
          tokenId: verified.payload.jti,
        }),
      };
    },
  };
  return Object.freeze(implementation);
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
): Promise<
  | { readonly ok: true; readonly payload: ValidatedPayload }
  | ProofFailure
> {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return invalidProof();
  }

  try {
    const { payload } = await jwtVerify(token, keyResolver, {
      algorithms: ["ES384"],
      issuer: config.issuer,
      audience: config.audience,
      requiredClaims: ["iss", "aud", "sub", "iat", "exp"],
    });
    if (
      typeof payload.iss !== "string" ||
      typeof payload.sub !== "string" ||
      payload.sub.length === 0 ||
      payload.sub.length > 500 ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp - payload.iat > MAX_ACCESS_TOKEN_LIFETIME_SECONDS ||
      payload.exp <= payload.iat
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
  if (config.jwks !== undefined) {
    return createLocalJWKSet(config.jwks);
  }
  const jwksUrl = new URL(config.jwksUrl ?? "");
  if (jwksUrl.protocol !== "https:" && jwksUrl.hostname !== "127.0.0.1") {
    throw new TypeError("jwksUrl must use HTTPS outside loopback development");
  }
  return createRemoteJWKSet(jwksUrl, {
    timeoutDuration: 2_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60 * 1_000,
  });
}

function interactiveTimestamp(payload: ValidatedPayload): string | undefined {
  const value = payload.inside_interactive_at;
  if (typeof value !== "string") {
    return undefined;
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    Math.abs(milliseconds / 1_000 - payload.iat) > MAX_INTERACTIVE_IAT_SKEW_SECONDS
  ) {
    return undefined;
  }
  return new Date(milliseconds).toISOString();
}

function validVerifiedEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 320 &&
    value.includes("@")
  );
}

function humanSessionIdentity(
  issuer: string,
  subject: string,
): VerifiedHumanSessionIdentity {
  return verifiedHumanSessionIdentity({ issuer, subject });
}

function invalidProof(): ProofFailure {
  return { ok: false, error: { code: "invalid_proof" } };
}

function isDependencyFailure(error: unknown, remoteJwks: boolean): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if ("code" in error && error.code === "ERR_JWKS_TIMEOUT") {
    return true;
  }
  if (!remoteJwks) {
    return false;
  }
  return (
    error instanceof TypeError ||
    ("code" in error &&
      error.code === "ERR_JOSE_GENERIC" &&
      error.message.includes("JSON Web Key Set HTTP response"))
  );
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}
