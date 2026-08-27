const DEFAULT_DATABASE_URL =
  "postgresql://inside:inside@127.0.0.1:5432/inside";
const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT = "3001";
const DEFAULT_LOGTO_ISSUER = "https://identity.inside.localhost:3301/oidc";
const DEFAULT_LOGTO_AUDIENCE = "http://127.0.0.1:3001";
const DEFAULT_LOGTO_JWKS_URL = "https://identity.inside.localhost:3301/oidc/jwks";
const DEFAULT_EMAIL_FINGERPRINT_KEY = "inside-local-email-fingerprint-key";
const DEFAULT_MEMBERSHIP_ACQUISITION_URL = "https://t.me/tribute";

export const PLATFORM_CONFIG = Symbol("PLATFORM_CONFIG");

export type PlatformMode = "development" | "test" | "production";

export interface PlatformConfig {
  readonly mode: PlatformMode;
  readonly database: Readonly<{
    url: string;
  }>;
  readonly api: Readonly<{
    host: string;
    port: number;
  }>;
  readonly identity: Readonly<{
    issuer: string;
    audience: string;
    jwksUrl: string;
    emailFingerprintKey: string;
  }>;
  readonly contentAccess: Readonly<{
    membershipAcquisitionUrl: string;
  }>;
}

export type PlatformDatabaseConfig = PlatformConfig["database"];

function parseMode(value: string | undefined): PlatformMode {
  const mode = value ?? "production";
  if (mode === "development" || mode === "test" || mode === "production") {
    return mode;
  }

  throw new Error("NODE_ENV must be development, test, or production");
}

function readRuntimeValue(
  environment: NodeJS.ProcessEnv,
  name:
    | "API_HOST"
    | "API_PORT"
    | "DATABASE_URL"
    | "IDENTITY_EMAIL_FINGERPRINT_KEY"
    | "LOGTO_AUDIENCE"
    | "LOGTO_ISSUER"
    | "LOGTO_JWKS_URL"
    | "MEMBERSHIP_ACQUISITION_URL",
  mode: PlatformMode,
  localDefault: string,
): string {
  const value = environment[name]?.trim();
  if (value !== undefined && value.length > 0) {
    return value;
  }
  if (mode !== "production") {
    return localDefault;
  }

  throw new Error(`${name} is required in production mode`);
}

function validateDatabaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid URL");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      "DATABASE_URL must use the postgres or postgresql protocol",
    );
  }

  return value;
}

function parseApiPort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }

  return port;
}

function validateHttpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  return value;
}

function parseIdentityConfig(
  environment: NodeJS.ProcessEnv,
  mode: PlatformMode,
): PlatformConfig["identity"] {
  const issuer = validateHttpUrl(
    readRuntimeValue(environment, "LOGTO_ISSUER", mode, DEFAULT_LOGTO_ISSUER),
    "LOGTO_ISSUER",
  );
  if (new URL(issuer).protocol !== "https:") {
    throw new Error("LOGTO_ISSUER must use HTTPS");
  }
  const audience = validateHttpUrl(
    readRuntimeValue(environment, "LOGTO_AUDIENCE", mode, DEFAULT_LOGTO_AUDIENCE),
    "LOGTO_AUDIENCE",
  );
  const jwksUrl = validateHttpUrl(
    readRuntimeValue(environment, "LOGTO_JWKS_URL", mode, DEFAULT_LOGTO_JWKS_URL),
    "LOGTO_JWKS_URL",
  );
  if (mode === "production" && new URL(jwksUrl).protocol !== "https:") {
    throw new Error("LOGTO_JWKS_URL must use HTTPS in production mode");
  }
  const emailFingerprintKey = readRuntimeValue(
    environment,
    "IDENTITY_EMAIL_FINGERPRINT_KEY",
    mode,
    DEFAULT_EMAIL_FINGERPRINT_KEY,
  );
  if (emailFingerprintKey.length < 32) {
    throw new Error("IDENTITY_EMAIL_FINGERPRINT_KEY must contain at least 32 characters");
  }

  return Object.freeze({ issuer, audience, jwksUrl, emailFingerprintKey });
}

export function parsePlatformConfig(
  environment: NodeJS.ProcessEnv,
): PlatformConfig {
  const mode = parseMode(environment.NODE_ENV);
  const database = parsePlatformDatabaseConfig(environment, mode);
  const api = Object.freeze({
    host: readRuntimeValue(environment, "API_HOST", mode, DEFAULT_API_HOST),
    port: parseApiPort(
      readRuntimeValue(environment, "API_PORT", mode, DEFAULT_API_PORT),
    ),
  });
  const identity = parseIdentityConfig(environment, mode);
  const contentAccess = Object.freeze({
    membershipAcquisitionUrl: validateHttpUrl(
      readRuntimeValue(
        environment,
        "MEMBERSHIP_ACQUISITION_URL",
        mode,
        DEFAULT_MEMBERSHIP_ACQUISITION_URL,
      ),
      "MEMBERSHIP_ACQUISITION_URL",
    ),
  });

  return Object.freeze({ mode, database, api, identity, contentAccess });
}

export function parsePlatformDatabaseConfig(
  environment: NodeJS.ProcessEnv,
  mode: PlatformMode = parseMode(environment.NODE_ENV),
): PlatformDatabaseConfig {
  return Object.freeze({
    url: validateDatabaseUrl(
      readRuntimeValue(
        environment,
        "DATABASE_URL",
        mode,
        DEFAULT_DATABASE_URL,
      ),
    ),
  });
}
